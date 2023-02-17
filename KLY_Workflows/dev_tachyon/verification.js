import {
    
    GET_POOLS_URLS,GET_ALL_KNOWN_PEERS,GET_MAJORITY,IS_MY_VERSION_OLD,CHECK_IF_THE_SAME_DAY,

    GET_ACCOUNT_ON_SYMBIOTE,BLOCKLOG,BLS_VERIFY,GET_QUORUM,GET_FROM_STATE, QUICK_SORT

} from './utils.js'

import {LOG,SYMBIOTE_ALIAS,BLAKE3,GET_GMT_TIMESTAMP} from '../../KLY_Utils/utils.js'

import bls from '../../KLY_Utils/signatures/multisig/bls.js'

import OPERATIONS_VERIFIERS from './operationsVerifiers.js'

import Block from './essences/block.js'

import {GRACEFUL_STOP} from './life.js'

import fetch from 'node-fetch'

import Web3 from 'web3'




//_____________________________________________________________EXPORT SECTION____________________________________________________________________




export let




//Make all advanced stuff here-check block locally or ask from "GET_BLOCKS_URL" node for new blocks
//If no answer - try to find blocks somewhere else

GET_BLOCK = async(blockCreator,index) => {

    let blockID=blockCreator+":"+index
    
    return SYMBIOTE_META.BLOCKS.get(blockID).catch(_=>

        fetch(CONFIG.SYMBIOTE.GET_BLOCKS_URL+`/block/`+blockCreator+":"+index)
    
        .then(r=>r.json()).then(block=>{
    
            let hash=Block.genHash(block)
                
            if(typeof block.events==='object' && typeof block.prevHash==='string' && typeof block.sig==='string' && block.index===index && block.creator === blockCreator){
    
                BLOCKLOG(`New \x1b[36m\x1b[41;1mblock\x1b[0m\x1b[32m  fetched  \x1b[31m—│`,'S',hash,48,'\x1b[31m',block)

                SYMBIOTE_META.BLOCKS.put(blockID,block)
    
                return block
    
            }
    
        }).catch(async error=>{
    
            LOG(`No block \x1b[36;1m${blockCreator+":"+index}\u001b[38;5;3m for symbiote \x1b[36;1m${SYMBIOTE_ALIAS()}\u001b[38;5;3m ———> ${error}`,'W')
    
            LOG(`Going to ask for blocks from the other nodes(\x1b[32;1mGET_BLOCKS_URL\x1b[36;1m node is \x1b[31;1moffline\x1b[36;1m or another error occured)`,'I')
    

            //Combine all nodes we know about and try to find block there
            let allVisibleNodes=await GET_POOLS_URLS()

    
            for(let url of allVisibleNodes){

                if(url===CONFIG.SYMBIOTE.MY_HOSTNAME) continue
                
                let itsProbablyBlock=await fetch(url+`/block/`+blockID).then(r=>r.json()).catch(_=>false)
                
                if(itsProbablyBlock){
    
                    let hash=Block.genHash(itsProbablyBlock)

                    let overviewIsOk =
                    
                        typeof itsProbablyBlock.events==='object'
                        &&
                        typeof itsProbablyBlock.prevHash==='string'
                        &&
                        typeof itsProbablyBlock.sig==='string'
                        &&
                        itsProbablyBlock.index===index
                        &&
                        itsProbablyBlock.creator===blockCreator
                

                    if(overviewIsOk){
    
                        BLOCKLOG(`New \x1b[36m\x1b[41;1mblock\x1b[0m\x1b[32m  fetched  \x1b[31m—│`,'S',hash,48,'\x1b[31m',itsProbablyBlock)

                        SYMBIOTE_META.BLOCKS.put(blockID,itsProbablyBlock).catch(_=>{})
    
                        return itsProbablyBlock
    
                    }
    
                }
    
            }
            
        })
    
    )

},




GET_ASSIGNED_POOL = async (skipStage3Proof,qtPayload) => {

    /*
    
    SKIP_STAGE_3_PROOF has the following structure


    {
    
        subchain, - skipped subchain. The work on this chain will be delegated to another pool
        index,
        hash,

        aggregatedPub,
        aggregatedSignature, - SIG(`SKIP_STAGE_3:${subchain}:${index}:${hash}:${qtPayload}`)
        afkVoters
    
    }

    Using <subchain>, <index>, <hash> and <qtPayload> fields we can get the hash which will be used to find pool to assign
    
    */

    let {subchain,index,hash} = skipStage3Proof


    // Based on this hash - start the cycle over ACTIVE 
    let pseudoRandomHash = BLAKE3(subchain+index+hash+qtPayload)

    let activeReservePools = Object.entries(SYMBIOTE_META.VERIFICATION_THREAD.POOLS_METADATA)
    
        .filter(([_,validatorMetadata])=>!validatorMetadata.IS_STOPPED && validatorMetadata.IS_RESERVE) //take only active reservists

        .map(([validatorPubKey,_])=>validatorPubKey)


    let mapping = new Map() // random challenge is 256-bits points to pool public key which will be next reassignment in chain for stopped pool


    let firstChallenge = QUICK_SORT(

        activeReservePools.map(
        
            validatorPubKey => {

                let challenge = parseInt(BLAKE3(validatorPubKey+pseudoRandomHash),16)

                mapping.set(challenge,validatorPubKey)

                return challenge

            }
            
        )

    )[0]


    return mapping.get(firstChallenge)

},




GET_SKIP_PROCEDURE_STAGE_3_PROOFS = async (qtPayload,subchain,index,hash) => {

    // Get the 2/3N+1 of current quorum that they've seen the SKIP_PROCEDURE_STAGE_2 on hostchain


    let quorumMembers = await GET_POOLS_URLS(true)

    let payloadInJSON = JSON.stringify({subchain})

    let majority = GET_MAJORITY('QUORUM_THREAD')

    if(!SYMBIOTE_META.TEMP.has(qtPayload)){

        return

    }

    let checkpointTempDB = SYMBIOTE_META.TEMP.get(qtPayload).DATABASE

    let promises=[], signatures=[], pubKeys=[]


    let sendOptions={

        method:'POST',

        body:payloadInJSON

    }

    
    for(let memberHandler of quorumMembers){

        let responsePromise = fetch(memberHandler.url+'/skip_procedure_stage_3',sendOptions).then(r=>r.json()).then(async response=>{
 
            response.pubKey = memberHandler.pubKey

            return response

        }).catch(_=>false)

        promises.push(responsePromise)

    }

    //Run promises
    let pingbacks = (await Promise.all(promises)).filter(Boolean)


    for(let {status,sig,pubKey} of pingbacks){

        if(status==='SKIP_STAGE_3'){

            //Verify the signature
            
            let data =`SKIP_STAGE_3:${subchain}:${index}:${hash}:${qtPayload}`

            if(await bls.singleVerify(data,pubKey,sig)){

                signatures.push(sig)

                pubKeys.push(pubKey)

            }

        }

    }


    if(pubKeys.length>=majority){

        let aggregatedSignature = bls.aggregateSignatures(signatures)

        let aggregatedPub = bls.aggregatePublicKeys(pubKeys)

        let afkVoters = SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT.QUORUM.filter(pub=>!pubKeys.includes(pub))

        let object={subchain,index,hash,aggregatedPub,aggregatedSignature,afkVoters}


        //Store locally in temp db
        await checkpointTempDB.put('SKIP_STAGE_3:'+subchain,object).catch(_=>false)

        return object

    }

},

/*

<SUPER_FINALIZATION_PROOF> is an aggregated proof from 2/3N+1 pools from quorum that they each have 2/3N+1 commitments from other pools

Structure => {
    
    blockID:"7GPupbq1vtKUgaqVeHiDbEJcxS7sSjwPnbht4eRaDBAEJv8ZKHNCSu2Am3CuWnHjta:0",

    blockHash:"0123456701234567012345670123456701234567012345670123456701234567",

    aggregatedPub:"7cBETvyWGSvnaVbc7ZhSfRPYXmsTzZzYmraKEgxQMng8UPEEexpvVSgTuo8iza73oP",

    aggregatedSigna:"kffamjvjEg4CMP8VsxTSfC/Gs3T/MgV1xHSbP5YXJI5eCINasivnw07f/lHmWdJjC4qsSrdxr+J8cItbWgbbqNaM+3W4HROq2ojiAhsNw6yCmSBXl73Yhgb44vl5Q8qD",

    afkVoters:[]

}

********************************************** ONLY AFTER VERIFICATION OF SUPER_FINALIZATION_PROOF YOU CAN PROCESS THE BLOCK **********************************************

Verification process:

    Saying, you need to get proofs to add some block 1337th generated by validator Andy with hash "cafe..."

    Once you find the candidate for SUPER_FINALIZATION_PROOF , you should verify

        [+] let shouldAccept = await VERIFY(aggregatedPub,aggregatedSigna,"Andy:1337"+":cafe:"+'FINALIZATION')

            Also, check if QUORUM_AGGREGATED_PUB === AGGREGATE(aggregatedPub,afkVoters)

    If this both conditions is ok - then you can accept block with 100% garantee of irreversibility

*/

GET_SUPER_FINALIZATION_PROOF = async (blockID,blockHash) => {


    let qtPayload = SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT.HEADER.PAYLOAD_HASH+SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT.HEADER.ID

    let vtPayload = SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.HEADER.PAYLOAD_HASH+SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.HEADER.ID

    // Need for async safety
    if(vtPayload!==qtPayload || !SYMBIOTE_META.TEMP.has(qtPayload)) return {skip:false,verify:false}

    let skipStage2Mapping = SYMBIOTE_META.TEMP.get(qtPayload).SKIP_PROCEDURE_STAGE_2

    let [subchain,index] = blockID.split(':')

    let checkpointTemporaryDB = SYMBIOTE_META.TEMP.get(qtPayload).DATABASE

    index = +index


    if(skipStage2Mapping.has(subchain)){

        let alreadySkipped = await checkpointTemporaryDB.get('FINAL_SKIP_STAGE_3:'+subchain).catch(_=>false)

        if(alreadySkipped) return {skip:true,verify:false}



        //{INDEX,HASH}
        let skipStage2Data = skipStage2Mapping.get(subchain)

        //Structure is {subchain,index,hash,aggregatedPub,aggregatedSignature,afkVoters}
        let skipStage3Proof = await checkpointTemporaryDB.get('SKIP_STAGE_3:'+subchain).catch(_=>false) || await GET_SKIP_PROCEDURE_STAGE_3_PROOFS(qtPayload,subchain,skipStage2Data.INDEX,skipStage2Data.HASH).catch(_=>false)

        //{INDEX,HASH,IS_STOPPED}
        let currentMetadata = SYMBIOTE_META.VERIFICATION_THREAD.POOLS_METADATA[subchain]


        // Initially, check if subchain was stopped from this height:hash on this checkpoint
        if(skipStage3Proof && skipStage3Proof.index === currentMetadata.INDEX && skipStage3Proof.hash === currentMetadata.HASH){
    
            //Stop this subchain for the next iterations
            let successWrite = await checkpointTemporaryDB.put('FINAL_SKIP_STAGE_3:'+subchain,true).then(()=>true).catch(_=>false)

            if(successWrite) return {skip:true,verify:false}
             
        }    

    }
    
    let superFinalizationProof = await checkpointTemporaryDB.get('SFP:'+blockID).catch(_=>false)


    //We shouldn't verify local version of SFP, because we already did it. See the GET /super_finalization route handler

    if(superFinalizationProof){

        return superFinalizationProof.blockHash===blockHash ? {skip:false,verify:true} : {skip:false,verify:false,shouldDelete:true}

    }   

    //Go through known hosts and find SUPER_FINALIZATION_PROOF. Call GET /super_finalization route
    
    let quorumMembersURLs = [CONFIG.SYMBIOTE.GET_SUPER_FINALIZATION_PROOF_URL,...await GET_POOLS_URLS(),...GET_ALL_KNOWN_PEERS()]


    for(let memberURL of quorumMembersURLs){


        let itsProbablySuperFinalizationProof = await fetch(memberURL+'/super_finalization/'+blockID).then(r=>r.json()).catch(_=>false),

            generalAndTypeCheck =   itsProbablySuperFinalizationProof
                                    &&
                                    typeof itsProbablySuperFinalizationProof.aggregatedPub === 'string'
                                    &&
                                    typeof itsProbablySuperFinalizationProof.aggregatedSignature === 'string'
                                    &&
                                    typeof itsProbablySuperFinalizationProof.blockID === 'string'
                                    &&
                                    typeof itsProbablySuperFinalizationProof.blockHash === 'string'
                                    &&
                                    Array.isArray(itsProbablySuperFinalizationProof.afkVoters)


        if(generalAndTypeCheck){

            //Verify it before return

            let qtPayload = SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.HEADER.PAYLOAD_HASH+SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.HEADER.ID


            let aggregatedSignatureIsOk = await BLS_VERIFY(blockID+blockHash+'FINALIZATION'+qtPayload,itsProbablySuperFinalizationProof.aggregatedSignature,itsProbablySuperFinalizationProof.aggregatedPub),

                rootQuorumKeyIsEqualToProposed = SYMBIOTE_META.STATIC_STUFF_CACHE.get('VT_ROOTPUB') === bls.aggregatePublicKeys([itsProbablySuperFinalizationProof.aggregatedPub,...itsProbablySuperFinalizationProof.afkVoters]),

                quorumSize = SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.QUORUM.length,

                majority = GET_MAJORITY('VERIFICATION_THREAD')

            
            let majorityVotedForThis = quorumSize-itsProbablySuperFinalizationProof.afkVoters.length >= majority


            if(aggregatedSignatureIsOk && rootQuorumKeyIsEqualToProposed && majorityVotedForThis){

                return {skip:false,verify:true}

            }

        }

    }

    //If we can't find - try next time

    return {skip:false,verify:false}

},




WAIT_SOME_TIME=async()=>

    new Promise(resolve=>

        setTimeout(()=>resolve(),CONFIG.SYMBIOTE.WAIT_IF_CANT_FIND_CHECKPOINT)

    )
,




DELETE_VALIDATOR_POOLS_WHICH_HAVE_LACK_OF_STAKING_POWER=async validatorPubKey=>{

    //Try to get storage "POOL" of appropriate pool

    let poolStorage = await GET_FROM_STATE(validatorPubKey+'(POOL)_STORAGE_POOL')


    poolStorage.lackOfTotalPower=true

    poolStorage.stopCheckpointID=SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.HEADER.ID

    poolStorage.storedMetadata=SYMBIOTE_META.VERIFICATION_THREAD.POOLS_METADATA[validatorPubKey]


    delete SYMBIOTE_META.VERIFICATION_THREAD.POOLS_METADATA[validatorPubKey]

},




GET_NEXT_RESERVE_POOL_FOR_SUBCHAIN=(hashOfMetadataFromOldCheckpoint,nonce,activeReservePoolsRelatedToSubchain,reassignmentsArray)=>{


    // Hence it's a chain - take a nonce
    let pseudoRandomHash = BLAKE3(hashOfMetadataFromOldCheckpoint+nonce)
    
    let mapping = new Map() // random challenge is 256-bits points to pool public key which will be next reassignment in chain for stopped pool

    let arrayOfChallanges = activeReservePoolsRelatedToSubchain
    
        .filter(pubKey=>!reassignmentsArray.includes(pubKey))
        
        .map(validatorPubKey=>{

            let challenge = parseInt(BLAKE3(validatorPubKey+pseudoRandomHash),16)
    
            mapping.set(challenge,validatorPubKey)

            return challenge

        })
    

    let firstChallenge = QUICK_SORT(arrayOfChallanges)[0]
    
    return mapping.get(firstChallenge)
    
},




//Function to find,validate and process logic with new checkpoint
SET_UP_NEW_CHECKPOINT=async(limitsReached,checkpointIsCompleted)=>{


    //When we reach the limits of current checkpoint - then we need to execute the special operations

    if(limitsReached && !checkpointIsCompleted){


        let operations = SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.PAYLOAD.OPERATIONS


        //_____________________________To change it via operations___________________________

        let workflowOptionsTemplate = {...SYMBIOTE_META.VERIFICATION_THREAD.WORKFLOW_OPTIONS}
        
        SYMBIOTE_META.STATE_CACHE.set('WORKFLOW_OPTIONS',workflowOptionsTemplate)

        //___________________Create array of delayed unstaking transactions__________________

        SYMBIOTE_META.STATE_CACHE.set('DELAYED_OPERATIONS',[])

        //_____________________________Create object for slashing____________________________

        // Structure <pool> => <{delayedIds,pool}>
        SYMBIOTE_META.STATE_CACHE.set('SLASH_OBJECT',{})

        //But, initially, we should execute the SLASH_UNSTAKE operations because we need to prevent withdraw of stakes by rogue pool(s)/stakers
        for(let operation of operations){
        
            if(operation.type==='SLASH_UNSTAKE') await OPERATIONS_VERIFIERS.SLASH_UNSTAKE(operation.payload) //pass isFromRoute=undefined to make changes to state
        
        }


        //Here we have the filled(or empty) array of pools and delayed IDs to delete it from state
        
        
        //____________________Go through the SPEC_OPERATIONS and perform it__________________

        for(let operation of operations){
    
            if(operation.type==='SLASH_UNSTAKE') continue

            /*
            
            Perform changes here before move to the next checkpoint
            
            OPERATION in checkpoint has the following structure

            {
                type:<TYPE> - type from './operationsVerifiers.js' to perform this operation
                payload:<PAYLOAD> - operation body. More detailed about structure & verification process here => ./operationsVerifiers.js
            }
            

            */

            await OPERATIONS_VERIFIERS[operation.type](operation.payload) //pass isFromRoute=undefined to make changes to state
    
        }


        //_______________________Remove pools if lack of staking power_______________________


        let poolsToBeRemoved = [], promises = [], poolsArray = Object.keys(SYMBIOTE_META.VERIFICATION_THREAD.POOLS_METADATA)

        for(let validator of poolsArray){

            let promise = GET_FROM_STATE(validator+'(POOL)_STORAGE_POOL').then(poolStorage=>{

                if(poolStorage.totalPower<SYMBIOTE_META.VERIFICATION_THREAD.WORKFLOW_OPTIONS.VALIDATOR_STAKE) poolsToBeRemoved.push(validator)

            })

            promises.push(promise)

        }

        await Promise.all(promises.splice(0))

        //Now in toRemovePools we have IDs of pools which should be deleted from POOLS

        let deletePoolsPromises=[]

        for(let poolBLSAddress of poolsToBeRemoved){

            deletePoolsPromises.push(DELETE_VALIDATOR_POOLS_WHICH_HAVE_LACK_OF_STAKING_POWER(poolBLSAddress))

        }

        await Promise.all(deletePoolsPromises.splice(0))


        //________________________________Remove rogue pools_________________________________

        // These operations must be atomic
        let atomicBatch = SYMBIOTE_META.STATE.batch()

        let slashObject = await GET_FROM_STATE('SLASH_OBJECT')
        
        let slashObjectKeys = Object.keys(slashObject)
        


        for(let poolIdentifier of slashObjectKeys){


            //_____________ SlashObject has the structure like this <pool> => <{delayedIds,pool}> _____________
            
            // Delete the single storage
            atomicBatch.del(poolIdentifier+'(POOL)_STORAGE_POOL')

            // Delete metadata
            atomicBatch.del(poolIdentifier+'(POOL)')

            // Remove from pools tracking
            delete SYMBIOTE_META.VERIFICATION_THREAD.POOLS_METADATA[poolIdentifier]

            // Delete from cache
            SYMBIOTE_META.STATE_CACHE.delete(poolIdentifier+'(POOL)_STORAGE_POOL')

            SYMBIOTE_META.STATE_CACHE.delete(poolIdentifier+'(POOL)')


            let arrayOfDelayed = slashObject[poolIdentifier].delayedIds

            //Take the delayed operations array, move to cache and delete operations where pool === poolIdentifier
            for(let id of arrayOfDelayed){

                let delayedArray = await GET_FROM_STATE('DEL_OPER_'+id)

                // Each object in delayedArray has the following structure {fromPool,to,amount,units}
                let toDeleteArray = []

                for(let i=0;i<delayedArray.length;i++){

                    if(delayedArray[i].fromPool===poolIdentifier) toDeleteArray.push(i)

                }

                // Here <toDeleteArray> contains id's of UNSTAKE operations that should be deleted

                for(let txidIndex of toDeleteArray) delayedArray.splice(txidIndex,1) //remove single tx

            }


        }


        //______________Perform earlier delayed operations & add new operations______________

        let delayedTableOfIds = await GET_FROM_STATE('DELAYED_TABLE_OF_IDS')

        //If it's first checkpoints - add this array
        if(!delayedTableOfIds) delayedTableOfIds=[]

        
        let currentCheckpointIndex = SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.HEADER.ID
        
        let idsToDelete = []


        for(let i=0, lengthOfTable = delayedTableOfIds.length ; i < lengthOfTable ; i++){

            //Here we get the arrays of delayed operations from state and perform those, which is old enough compared to WORKFLOW_OPTIONS.UNSTAKING_PERIOD

            if(delayedTableOfIds[i] + SYMBIOTE_META.VERIFICATION_THREAD.WORKFLOW_OPTIONS.UNSTAKING_PERIOD < currentCheckpointIndex){

                let oldDelayOperations = await GET_FROM_STATE('DEL_OPER_'+delayedTableOfIds[i])

                if(oldDelayOperations){

                    for(let delayedTX of oldDelayOperations){

                        /*

                            Get the accounts and add appropriate amount of KLY / UNO

                            delayedTX has the following structure

                            {
                                fromPool:<id of pool that staker withdraw stake from>,

                                to:<staker pubkey/address>,
                    
                                amount:<number>,
                    
                                units:< KLY | UNO >
                    
                            }
                        
                        */

                        let account = await GET_ACCOUNT_ON_SYMBIOTE(delayedTX.to)

                        //Return back staked KLY / UNO to the state of user's account
                        if(delayedTX.units==='kly') account.balance += delayedTX.amount

                        else account.uno += delayedTX.amount
                        

                    }


                    //Remove ID (delayedID) from delayed table of IDs because we already used it
                    idsToDelete.push(i)

                }

            }

        }

        //Remove "spent" ids
        for(let id of idsToDelete) delayedTableOfIds.splice(id,1)



        //Also, add the array of delayed operations from THIS checkpoint if it's not empty
        let currentArrayOfDelayedOperations = await GET_FROM_STATE('DELAYED_OPERATIONS')
        
        if(currentArrayOfDelayedOperations.length !== 0){

            delayedTableOfIds.push(currentCheckpointIndex)

            SYMBIOTE_META.STATE_CACHE.set('DEL_OPER_'+currentCheckpointIndex,currentArrayOfDelayedOperations)

        }

        // Set the DELAYED_TABLE_OF_IDS to DB
        SYMBIOTE_META.STATE_CACHE.set('DELAYED_TABLE_OF_IDS',delayedTableOfIds)

        //Delete the temporary from cache
        SYMBIOTE_META.STATE_CACHE.delete('DELAYED_OPERATIONS')

        SYMBIOTE_META.STATE_CACHE.delete('SLASH_OBJECT')


        //_______________________Commit changes after operations here________________________

        //Update the WORKFLOW_OPTIONS
        SYMBIOTE_META.VERIFICATION_THREAD.WORKFLOW_OPTIONS={...workflowOptionsTemplate}

        SYMBIOTE_META.STATE_CACHE.delete('WORKFLOW_OPTIONS')


        // Mark checkpoint as completed not to repeat the operations twice
        SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.COMPLETED=true
       
        //Create new quorum based on new POOLS_METADATA state
        SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.QUORUM = GET_QUORUM(SYMBIOTE_META.VERIFICATION_THREAD.POOLS_METADATA,SYMBIOTE_META.VERIFICATION_THREAD.WORKFLOW_OPTIONS)

        //Get the new rootpub
        SYMBIOTE_META.STATIC_STUFF_CACHE.set('VT_ROOTPUB',bls.aggregatePublicKeys(SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.QUORUM))


        /*
        
            ____________________________________After running all SPECIAL_OPERATIONS we should do the following____________________________________        
        
                [*] If some of pools which have KLY-EVMs not present in SYMBIOTE_META.VERIFICATION_THREAD.POOLS_METADATA - reassign it to other subchains
                [*] In case some of subchains were stopped - find worker using hash of SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.PAYLOAD.POOLS_METADATA and nonces

        */

        // [*] In case some of subchains were stopped - find worker using hash of SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.PAYLOAD.POOLS_METADATA and nonces

        let hashOfPoolsMetadataInCheckpoint = BLAKE3(JSON.stringify(SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.PAYLOAD.POOLS_METADATA))

        // Build the graphs

        let subchainsIDs = new Set()

        let activeReservePoolsRelatedToSubchainAndStillNotUsed = new Map() // subchainID => [] - array of active reserved pool

        
        for(let [poolPubKey,poolMetadata] of Object.entries(SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.PAYLOAD.POOLS_METADATA)){

            if(!poolMetadata.IS_RESERVE){

                subchainsIDs.add(poolPubKey)

            }
            else if(!poolMetadata.IS_STOPPED){

                // Otherwise - it's reserve pool

                let originSubchain = await SYMBIOTE_META.STATE.get(poolPubKey+`(POOL)_POINTER`)
                    
                let poolStorage = await SYMBIOTE_META.STATE.get(BLAKE3(originSubchain+poolPubKey+`(POOL)_STORAGE_POOL`))

                if(poolStorage){

                    let {reserveFor} = poolStorage

                    if(!activeReservePoolsRelatedToSubchainAndStillNotUsed.has(reserveFor)) activeReservePoolsRelatedToSubchainAndStillNotUsed.set(reserveFor,[])

                    activeReservePoolsRelatedToSubchainAndStillNotUsed.get(reserveFor).push(poolPubKey)
                    
                }

            }

        }

         

        let specialOperationsOnThisCheckpoint = SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.PAYLOAD.OPERATIONS

        // First of all - get all the <SKIP> special operations on new checkpoint and add the skipped pools to set

        let skippedPools = new Set()

        for(let operation of specialOperationsOnThisCheckpoint){

            /* 
            
                Reminder: STOP_VALIDATOR speical operation payload has the following structure
            
                {
                    type, stop, subchain, index, hash
                    
                }
                
            */

            if(operation.type==='STOP_VALIDATOR'){

                skippedPools.add(operation.payload.subchain)

            }

        }
            

        SYMBIOTE_META.VERIFICATION_THREAD.REASSIGNMENTS={}


        for(let subchainPoolID of subchainsIDs){
            
            // Find stopped subchains on new checkpoint and assign a new pool to this subchain deterministically
            
            let nextReservePool = subchainPoolID
            
            let nonce = 0
            
            while(skippedPools.has(nextReservePool)){
            
                if(!SYMBIOTE_META.VERIFICATION_THREAD.REASSIGNMENTS[subchainPoolID]){
            
                    SYMBIOTE_META.VERIFICATION_THREAD.REASSIGNMENTS[subchainPoolID] = []
            
                }
            
                let possibleNextReservePool = GET_NEXT_RESERVE_POOL_FOR_SUBCHAIN(hashOfPoolsMetadataInCheckpoint,nonce,activeReservePoolsRelatedToSubchainAndStillNotUsed.get(subchainPoolID),SYMBIOTE_META.VERIFICATION_THREAD.REASSIGNMENTS[subchainPoolID])
            
                if(possibleNextReservePool){
            
                    SYMBIOTE_META.VERIFICATION_THREAD.REASSIGNMENTS[subchainPoolID][0]=possibleNextReservePool
            
                    nextReservePool = possibleNextReservePool
            
                    nonce++
            
                }else break
            
            }
            
            if(nextReservePool!==subchainPoolID && SYMBIOTE_META.VERIFICATION_THREAD.REASSIGNMENTS[subchainPoolID].length===0) delete SYMBIOTE_META.VERIFICATION_THREAD.REASSIGNMENTS[subchainPoolID]

            let initialReserve = SYMBIOTE_META.VERIFICATION_THREAD.REASSIGNMENTS[subchainPoolID][0]

            if(initialReserve) SYMBIOTE_META.VERIFICATION_THREAD.REASSIGNMENTS[initialReserve]=subchainPoolID

            // On this step, in SYMBIOTE_META.VERIFICATION_THREAD.REASSIGNMENTS we have arrays with reserve pools for subchains where main validator is stopped
        
        }



        // [*] If some of pools which have KLY-EVMs not present in SYMBIOTE_META.VERIFICATION_THREAD.POOLS_METADATA - reassign it to other subchains
        
        let poolsIdsAndMetadata = Object.entries(SYMBIOTE_META.VERIFICATION_THREAD.POOLS_METADATA)

        let alreadyInResponseForEVM = Object.keys(SYMBIOTE_META.VERIFICATION_THREAD.KLY_EVM_REASSIGN)


        for(let [responsiblePoolID,evmID] of Object.entries(SYMBIOTE_META.VERIFICATION_THREAD.KLY_EVM_REASSIGN)){

            if(!SYMBIOTE_META.VERIFICATION_THREAD.POOLS_METADATA[responsiblePoolID]){

                // Assing the new subchain to be responsible for appropriate KLY-EVM
                
                for(let [poolID,poolMetadata] of poolsIdsAndMetadata) {

                    if(!poolMetadata.IS_RESERVE && !alreadyInResponseForEVM.includes(poolID)){

                        SYMBIOTE_META.VERIFICATION_THREAD.KLY_EVM_REASSIGN[poolID]=evmID

                    }
    
                }

            }

        }


        LOG(`\u001b[38;5;154mSpecial operations were executed for checkpoint \u001b[38;5;93m${SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.HEADER.ID} ### ${SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.HEADER.PAYLOAD_HASH} (VT)\u001b[0m`,'S')


        //Commit the changes of state using atomic batch
        SYMBIOTE_META.STATE_CACHE.forEach(
            
            (value,recordID) => atomicBatch.put(recordID,value)
            
        )


        atomicBatch.put('VT',SYMBIOTE_META.VERIFICATION_THREAD)

        await atomicBatch.write()
    
    }


    //________________________________________ FIND NEW CHECKPOINT ________________________________________


    let currentTimestamp = GET_GMT_TIMESTAMP(),//due to UTC timestamp format

        checkpointIsFresh = CHECK_IF_THE_SAME_DAY(SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.TIMESTAMP,currentTimestamp)


    //If checkpoint is not fresh - find "fresh" one on hostchain

    if(!checkpointIsFresh){


        let nextCheckpoint = await HOSTCHAIN.MONITOR.GET_VALID_CHECKPOINT('VERIFICATION_THREAD').catch(_=>false)


        if(nextCheckpoint){


            let oldQuorum = SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.QUORUM

            let oldPoolsMetadataFromCheckpoint = JSON.parse(JSON.stringify(SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.PAYLOAD.POOLS_METADATA))

            let hashOfMetadataFromOldCheckpoint = BLAKE3(JSON.stringify(SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.PAYLOAD.POOLS_METADATA))


            //Set the new checkpoint
            SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT=nextCheckpoint

            // But quorum is the same as previous
            SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.QUORUM = oldQuorum

            //Get the new rootpub
            SYMBIOTE_META.STATIC_STUFF_CACHE.set('VT_ROOTPUB',bls.aggregatePublicKeys(SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.QUORUM))


            //______________________________Check if some subchains were stopped______________________________

            // Build the graphs

            let subchainsIDs = new Set()

            let activeReservePoolsRelatedToSubchainAndStillNotUsed = new Map() // subchainID => [] - array of active reserved pool

            
            for(let [poolPubKey,poolMetadata] of Object.entries(oldPoolsMetadataFromCheckpoint)){

                if(!poolMetadata.IS_RESERVE){

                    subchainsIDs.add(poolPubKey)

                }else if(!poolMetadata.IS_STOPPED){

                    // Otherwise - it's reserve pool

                    let originSubchain = await GET_FROM_STATE(poolPubKey+`(POOL)_POINTER`)
                    
                    let poolStorage = await SYMBIOTE_META.STATE.get(BLAKE3(originSubchain+poolPubKey+`(POOL)_STORAGE_POOL`))

                    if(poolStorage){

                        let {reserveFor} = poolStorage

                        if(!activeReservePoolsRelatedToSubchainAndStillNotUsed.has(reserveFor)) activeReservePoolsRelatedToSubchainAndStillNotUsed.set(reserveFor,[])

                        activeReservePoolsRelatedToSubchainAndStillNotUsed.get(reserveFor).push(poolPubKey)
                    
                    }

                }

            }

         

            let specialOperationsOnThisCheckpoint = nextCheckpoint.PAYLOAD.OPERATIONS

            // First of all - get all the <SKIP> special operations on new checkpoint and add the skipped pools to set

            let stoppedPools = new Set()

            for(let operation of specialOperationsOnThisCheckpoint){

                /* 
                
                    Reminder: STOP_VALIDATOR speical operation payload has the following structure
                
                    {
                       type, stop, subchain, index, hash
                    }
                
                */

                if(operation.type==='STOP_VALIDATOR'){

                    stoppedPools.add(operation.payload.subchain)

                }

            }
            



            for(let subchainPoolID of subchainsIDs){

                // Find stopped subchains on new checkpoint and assign a new pool to this subchain deterministically

                let nextReservePool = subchainPoolID

                if(oldPoolsMetadataFromCheckpoint[subchainPoolID].IS_STOPPED && SYMBIOTE_META.VERIFICATION_THREAD.REASSIGNMENTS[subchainPoolID]){

                    /*
                    
                        If some of subchains were stopped on previous checkpoint - it's a signal that the beginning of chain is hidden here:
                        
                        SYMBIOTE_META.VERIFICATION_THREAD.REASSIGNMENTS  in form like STOPPED_POOL_ID => [<ASSIGNED_POOL_0,<ASSIGNED_POOL_1,...<ASSIGNED_POOL_N>]

                        and the reponsible for pool is REASSIGNMENTS[<skipped_subchain_id>][0]
                    
                    */
                    
                    nextReservePool = SYMBIOTE_META.VERIFICATION_THREAD.REASSIGNMENTS[subchainPoolID][0]

                }

                let nonce = 0


                while(stoppedPools.has(nextReservePool)){

                    if(!SYMBIOTE_META.VERIFICATION_THREAD.REASSIGNMENTS[subchainPoolID]){

                        SYMBIOTE_META.VERIFICATION_THREAD.REASSIGNMENTS[subchainPoolID] = []

                    }
                    
                    // Now check if <startOfChain> pool wasn't stopped

                    if(stoppedPools.has(nextReservePool)){

                        // if yes - find next responsible for work on this pool in a row

                        let possibleNextReservePool = GET_NEXT_RESERVE_POOL_FOR_SUBCHAIN(hashOfMetadataFromOldCheckpoint,nonce,activeReservePoolsRelatedToSubchainAndStillNotUsed.get(subchainPoolID),SYMBIOTE_META.VERIFICATION_THREAD.REASSIGNMENTS[subchainPoolID])

                        if(possibleNextReservePool){

                            SYMBIOTE_META.VERIFICATION_THREAD.REASSIGNMENTS[subchainPoolID].push(possibleNextReservePool)

                            SYMBIOTE_META.VERIFICATION_THREAD.REASSIGNMENTS[possibleNextReservePool]=subchainPoolID

                            nextReservePool = possibleNextReservePool

                            nonce++

                        }else break

                    }

                }

                // On this step, in SYMBIOTE_META.VERIFICATION_THREAD.REASSIGNMENTS we have arrays with reserve pools which also should be verified in context of subchain for a final valid state


            }


            //_______________________Check the version required for the next checkpoint________________________

            if(IS_MY_VERSION_OLD('VERIFICATION_THREAD')){

                LOG(`New version detected on VERIFICATION_THREAD. Please, upgrade your node software`,'W')

                // Stop the node to update the software
                GRACEFUL_STOP()

            }

        } else {

            LOG(`Going to wait for next checkpoint, because current is non-fresh and no new checkpoint found. No sense to spam. Wait ${CONFIG.SYMBIOTE.WAIT_IF_CANT_FIND_CHECKPOINT/1000} seconds ...`,'I')

            await WAIT_SOME_TIME()

        }
    
    }

},




CAN_WE_CHANGE_THE_STATE_OF_SUBCHAIN_WITH_BLOCKS_OF_THIS_RESERVE_POOL=reservePoolPubKey=>{

    let subchainID = SYMBIOTE_META.VERIFICATION_THREAD.REASSIGNMENTS[reservePoolPubKey]

    return subchainID && SYMBIOTE_META.VERIFICATION_THREAD.REASSIGNMENTS[subchainID][0] === reservePoolPubKey

},




START_VERIFICATION_THREAD=async()=>{

    //This option will stop workflow of verification for each symbiote
    
    if(!SYSTEM_SIGNAL_ACCEPTED){

        //_______________________________ Check if we reach checkpoint stats to find out next one and continue work on VT _______________________________

        let currentPoolsMetadataHash = BLAKE3(JSON.stringify(SYMBIOTE_META.VERIFICATION_THREAD.POOLS_METADATA)),

            poolsMetadataHashFromCheckpoint = BLAKE3(JSON.stringify(SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.PAYLOAD.POOLS_METADATA))

        

        //If we reach the limits of current checkpoint - find another one. In case there are no more checkpoints - mark current checkpoint as "completed"
        await SET_UP_NEW_CHECKPOINT(currentPoolsMetadataHash === poolsMetadataHashFromCheckpoint,SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.COMPLETED)


        //Updated checkpoint on previous step might be old or fresh,so we should update the variable state

        let updatedIsFreshCheckpoint = CHECK_IF_THE_SAME_DAY(SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.TIMESTAMP,GET_GMT_TIMESTAMP())


        /*

            ! Glossary - SUPER_FINALIZATION_PROOF on high level is proof that for block Y created by validator PubX with hash H exists at least 2/3N+1 from quorum who has 2/3N+1 commitments for this block

                [+] If our current checkpoint are "too old", no sense to find SUPER_FINALIZATION_PROOF. Just find & process block
        
                [+] If latest checkpoint was created & published on hostchains(primary and other hostchains via HiveMind) we should find SUPER_FINALIZATION_PROOF to proceed the block
        

        */


        let prevSubchainWeChecked = SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.SUBCHAIN,

            poolsPubkeys = Object.keys(SYMBIOTE_META.VERIFICATION_THREAD.POOLS_METADATA),

            //take the next validator in a row. If it's end of pools - start from the first validator in array
            currentPoolToCheck = poolsPubkeys[poolsPubkeys.indexOf(prevSubchainWeChecked)+1] || poolsPubkeys[0],

            //We receive {INDEX,HASH,IS_STOPPED} - it's data from previously checked blocks on this pools' track. We're going to verify next block(INDEX+1)
            currentSessionMetadata = SYMBIOTE_META.VERIFICATION_THREAD.POOLS_METADATA[currentPoolToCheck],

            blockID = currentPoolToCheck+":"+(currentSessionMetadata.INDEX+1),

            shouldSkip = false
        

        //If current validator was marked as "offline" or AFK - skip his blocks till his activity signals
        //Change the state of validator activity only via checkpoints



        if(currentSessionMetadata.IS_STOPPED){

            /*
            
                Here we do everything to skip this block and move to the next subchains's block
                        
                If 2/3+1 of quorum have voted to "skip" block - we take the "NEXT+1" block and continue work in verification thread
                    
                Here we just need to change finalized pointer to imitate that "skipped" block was successfully checked and next validator's block should be verified(in the next iteration)

            */

                
            SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.SUBCHAIN=currentPoolToCheck

            SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.INDEX=currentSessionMetadata.INDEX+1
                                    
            SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.HASH='Sleep,the brother of Death @ Homer'


        }
        else if(currentSessionMetadata.IS_RESERVE && CAN_WE_CHANGE_THE_STATE_OF_SUBCHAIN_WITH_BLOCKS_OF_THIS_RESERVE_POOL(currentPoolToCheck) || !currentSessionMetadata.IS_RESERVE) {

            //If block creator is active and produce blocks or it's non-fresh checkpoint - we can get block and process it

            let block = await GET_BLOCK(currentPoolToCheck,currentSessionMetadata.INDEX+1),

                blockHash = block && Block.genHash(block),

                quorumSolutionToVerifyBlock = false, //by default

                currentBlockPresentInCurrentCheckpoint = SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.PAYLOAD.POOLS_METADATA[currentPoolToCheck]?.INDEX > currentSessionMetadata.INDEX,

                checkPointCompleted  = SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.COMPLETED
        
            

            if(currentBlockPresentInCurrentCheckpoint){

                quorumSolutionToVerifyBlock = true

            }
        
            else if(!checkPointCompleted) {

                //if no sush block in current uncompleted checkpoint - then we need to skip it.
                shouldSkip = true

            }

            else if(updatedIsFreshCheckpoint){

                let {skip,verify,shouldDelete} = await GET_SUPER_FINALIZATION_PROOF(blockID,blockHash).catch(_=>({skip:false,verify:false}))

                quorumSolutionToVerifyBlock = verify

                shouldSkip = skip

                if(shouldDelete){

                    // Probably - hash mismatch 

                    await SYMBIOTE_META.BLOCKS.del(blockID).catch(_=>{})

                }
            
            }

            //We skip the block if checkpoint is not completed and no such block in checkpoint
            //No matter if checkpoint is fresh or not

            if(shouldSkip){

                SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.SUBCHAIN=currentPoolToCheck

                SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.INDEX=currentSessionMetadata.INDEX+1
                                        
                SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.HASH='Sleep,the brother of Death @ Homer'


            }else if(block && quorumSolutionToVerifyBlock){


                let subchainContext = currentSessionMetadata.IS_RESERVE ? SYMBIOTE_META.VERIFICATION_THREAD.REASSIGNMENTS[currentPoolToCheck] : currentPoolToCheck

                await verifyBlock(block,subchainContext)

                
                if(currentSessionMetadata.IS_RESERVE){

                    let metaFromCheckpoint = SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.PAYLOAD.POOLS_METADATA[currentPoolToCheck]

                    if(metaFromCheckpoint.INDEX === currentSessionMetadata.INDEX && metaFromCheckpoint.HASH === currentSessionMetadata.HASH){

                        // Delete from reassignments to move to the next pool in subchain

                        let origin = SYMBIOTE_META.VERIFICATION_THREAD.REASSIGNMENTS[currentPoolToCheck]

                        delete SYMBIOTE_META.VERIFICATION_THREAD.REASSIGNMENTS[currentPoolToCheck]

                        SYMBIOTE_META.VERIFICATION_THREAD.REASSIGNMENTS[origin].shift()

                    }

                }

                LOG(`Local VERIFICATION_THREAD state is \x1b[32;1m${SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.SUBCHAIN} \u001b[38;5;168m}———{\x1b[32;1m ${SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.INDEX} \u001b[38;5;168m}———{\x1b[32;1m ${SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.HASH}\n`,'I')
                

            }

        }else{

            SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.SUBCHAIN=currentPoolToCheck

            SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.INDEX=currentSessionMetadata.INDEX+1
                                    
            SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.HASH='Sleep,the brother of Death @ Homer'

        }


        if(CONFIG.SYMBIOTE.STOP_VERIFY) return//step over initiation of another timeout and this way-stop the Verification Thread

        //If next block is available-instantly start perform.Otherwise-wait few seconds and repeat request

        setTimeout(START_VERIFICATION_THREAD,0)

    
    }else{

        LOG(`Polling for \x1b[32;1m${SYMBIOTE_ALIAS()}\x1b[36;1m was stopped`,'I',CONFIG.SYMBIOTE.SYMBIOTE_ID)

    }

},




SHARE_FEES_AMONG_STAKERS=async(poolId,feeToPay)=>{


    let mainStorageOfPool = await GET_FROM_STATE(BLAKE3(poolId+poolId+'(POOL)_STORAGE_POOL'))

    if(mainStorageOfPool.percentage!==0){

        //Get the pool percentage and send to appropriate BLS address
        let poolBindedAccount = await GET_ACCOUNT_ON_SYMBIOTE(BLAKE3(poolId+poolId))

        poolBindedAccount.balance += mainStorageOfPool.percentage*feeToPay
        
    }

    let restOfFees = feeToPay - mainStorageOfPool.percentage*feeToPay

    //Iteration over the {KLY,UNO,REWARD}
    Object.values(mainStorageOfPool.stakers).forEach(stakerStats=>{

        let stakerTotalPower = stakerStats.uno + stakerStats.kly

        let totalStakerPowerPercent = stakerTotalPower/mainStorageOfPool.totalPower

        stakerStats.reward += totalStakerPowerPercent*restOfFees

    })

},




// We need this method to send fees to this special account and 
SEND_FEES_TO_SPECIAL_ACCOUNTS_ON_THE_SAME_SUBCHAIN = async(subchainID,feeRecepientPool,feeReward) => {

    // We should get the object {reward:X}. This metric shows "How much does pool <feeRecepientPool> get as a reward from txs on subchain <subchainID>"
    // In order to protocol, not all the fees go to the subchain authority - part of them are sent to the rest of subchains authorities(to pools) and smart contract automatically distribute reward among stakers of this pool

    let accountsForFeesId = BLAKE3(subchainID+feeRecepientPool+'_FEES')

    let feesAccountForGivenPoolOnThisSubchain = await GET_FROM_STATE(accountsForFeesId) || {reward:0}

    feesAccountForGivenPoolOnThisSubchain.reward+=feeReward

    SYMBIOTE_META.STATE_CACHE.set(accountsForFeesId,feesAccountForGivenPoolOnThisSubchain)

},




//Function to distribute stakes among blockCreator/staking pools
DISTRIBUTE_FEES=async(totalFees,subchainContext,activePoolsSet)=>{

    /*

        _____________________Here we perform the following logic_____________________

        [*] totalFees - number of total fees received in this block



        1) Take all the ACTIVE pools from SYMBIOTE_META.VERIFICATION_THREAD.POOLS_METADATA

        2) Send REWARD_PERCENTAGE_FOR_BLOCK_CREATOR * totalFees to block creator

        3) Distribute the rest among all the other pools(excluding block creator)

            For this, we should:

            3.1) Take the pool storage from state by id = validatorPubKey+'(POOL)_STORAGE_POOL'

            3.2) Run the cycle over the POOL.STAKERS(structure is STAKER_PUBKEY => {KLY,UNO,REWARD}) and increase reward by FEES_FOR_THIS_VALIDATOR * ( STAKER_POWER_IN_UNO / TOTAL_POOL_POWER )

    
    */

    let payToCreatorAndHisPool = totalFees * SYMBIOTE_META.VERIFICATION_THREAD.WORKFLOW_OPTIONS.REWARD_PERCENTAGE_FOR_BLOCK_CREATOR, //the bigger part is usually for block creator

        payToEachPool = Math.floor((totalFees - payToCreatorAndHisPool)/(activePoolsSet.size-1)), //and share the rest among other pools
    
        shareFeesPromises = []

          
    if(activePoolsSet.size===1) payToEachPool = totalFees - payToCreatorAndHisPool


    //___________________________________________ BLOCK_CREATOR ___________________________________________

    shareFeesPromises.push(SHARE_FEES_AMONG_STAKERS(subchainContext,payToCreatorAndHisPool))

    //_____________________________________________ THE REST ______________________________________________

    activePoolsSet.forEach(feesRecepientPoolPubKey=>

        feesRecepientPoolPubKey !== subchainContext && shareFeesPromises.push(SEND_FEES_TO_SPECIAL_ACCOUNTS_ON_THE_SAME_SUBCHAIN(subchainContext,feesRecepientPoolPubKey,payToEachPool))
            
    )
     
    await Promise.all(shareFeesPromises.splice(0))

},




verifyBlock=async(block,subchainContext)=>{


    let blockHash=Block.genHash(block),

        overviewOk=
    
            block.events?.length<=SYMBIOTE_META.VERIFICATION_THREAD.WORKFLOW_OPTIONS.EVENTS_LIMIT_PER_BLOCK
            &&
            SYMBIOTE_META.VERIFICATION_THREAD.POOLS_METADATA[block.creator].HASH === block.prevHash//it should be a chain
            &&
            await BLS_VERIFY(blockHash,block.sig,block.creator)


    // if(block.i === CONFIG.SYMBIOTE.SYMBIOTE_CHECKPOINT.HEIGHT && blockHash !== CONFIG.SYMBIOTE.SYMBIOTE_CHECKPOINT.HEIGHT){

    //     LOG(`SYMBIOTE_CHECKPOINT verification failed. Delete the CHAINDATA/BLOCKS,CHAINDATA/METADATA,CHAINDATA/STATE and SNAPSHOTS. Resync node with the right blockchain or load the true snapshot`,'F')

    //     LOG('Going to stop...','W')

    //     process.emit('SIGINT')

    // }


    if(overviewOk){


        //To calculate fees and split among pools.Currently - general fees sum is 0. It will be increased each performed transaction
        
        let rewardBox={fees:0}

        let currentBlockID = block.creator+":"+block.index

        let evmIDForLogs = SYMBIOTE_META.VERIFICATION_THREAD.KLY_EVM_REASSIGN[subchainContext]

        if(evmIDForLogs) SYMBIOTE_META.STATE_CACHE.set(evmIDForLogs+'EVM_LOGS_MAP',{}) // (contractAddress => array of logs) to store logs created by KLY-EVM


        //To change the state atomically
        let atomicBatch = SYMBIOTE_META.STATE.batch()


        //_________________________________________GET ACCOUNTS FROM STORAGE____________________________________________
        
        let accountsToAddToCache=[]
    
        //Push accounts for fees of subchains authorities

        let activePools = new Set()

        for(let [validatorPubKey,metadata] of Object.entries(SYMBIOTE_META.VERIFICATION_THREAD.POOLS_METADATA)){

            if(!metadata.IS_STOPPED && !metadata.IS_RESERVE) activePools.add(validatorPubKey) 

        }

        activePools.forEach(
            
            pubKey => {

                // Avoid own pubkey to be added. On own chains we send rewards directly
                if(pubKey !== block.creator) accountsToAddToCache.push(GET_FROM_STATE(BLAKE3(subchainContext+pubKey+'_FEES')))

            }
            
        )

        //Now cache has all accounts and ready for the next cycles
        await Promise.all(accountsToAddToCache.splice(0))


        //___________________________________________START TO PERFORM EVENTS____________________________________________


        let txIndexInBlock=0

        for(let event of block.events){

            if(SYMBIOTE_META.VERIFIERS[event.type]){

                let eventCopy = JSON.parse(JSON.stringify(event))

                let {isOk,reason} = await SYMBIOTE_META.VERIFIERS[event.type](subchainContext,eventCopy,rewardBox,atomicBatch).catch(_=>{})

                // Set the receipt of tx(in case it's not EVM tx, because EVM automatically create receipt and we store it using KLY-EVM)
                if(reason!=='EVM'){

                    let txid = BLAKE3(eventCopy.sig) // txID is a BLAKE3 hash of event you sent to blockchain. You can recount it locally(will be used by wallets, SDKs, libs and so on)

                    atomicBatch.put('TX:'+txid,{blockID:currentBlockID,id:txIndexInBlock,isOk,reason})
    
                }

                txIndexInBlock++
                
            }

        }
        
        
        //__________________________________________SHARE FEES AMONG POOLS_________________________________________
        
        
        await DISTRIBUTE_FEES(rewardBox.fees,subchainContext,activePools)


        //Probably you would like to store only state or you just run another node via cloud module and want to store some range of blocks remotely
        if(CONFIG.SYMBIOTE.STORE_BLOCKS){
            
            //No matter if we already have this block-resave it

            SYMBIOTE_META.BLOCKS.put(currentBlockID,block).catch(
                
                error => LOG(`Failed to store block ${block.index} on ${SYMBIOTE_ALIAS()}\nError:${error}`,'W')
                
            )

        }else if(block.creator!==CONFIG.SYMBIOTE.PUB){

            //...but if we shouldn't store and have it locally(received probably by range loading)-then delete
            SYMBIOTE_META.BLOCKS.del(currentBlockID).catch(
                
                error => LOG(`Failed to delete block ${currentBlockID} on ${SYMBIOTE_ALIAS()}\nError:${error}`,'W')
                
            )

        }


        //________________________________________________COMMIT STATE__________________________________________________    


        SYMBIOTE_META.STATE_CACHE.forEach((account,addr)=>

            atomicBatch.put(addr,account)

        )
        
        if(SYMBIOTE_META.STATE_CACHE.size>=CONFIG.SYMBIOTE.BLOCK_TO_BLOCK_CACHE_SIZE) SYMBIOTE_META.STATE_CACHE.clear()//flush cache.NOTE-some kind of advanced upgrade soon


        // Store the currently relative block index (RID)

        let currentRID = SYMBIOTE_META.VERIFICATION_THREAD.RID_TRACKER[subchainContext]

        atomicBatch.put(`RID:${subchainContext}:${currentRID}`,currentBlockID)

        SYMBIOTE_META.VERIFICATION_THREAD.RID_TRACKER[subchainContext]++


        let oldGRID = SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.GRID

        //Change finalization pointer
        
        SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.SUBCHAIN=block.creator

        SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.INDEX=block.index
                
        SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.HASH=blockHash

        SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.GRID++

        atomicBatch.put(`GRID:${oldGRID}`,currentBlockID)
        
        //Change metadata per validator's thread
        
        SYMBIOTE_META.VERIFICATION_THREAD.POOLS_METADATA[block.creator].INDEX=block.index

        SYMBIOTE_META.VERIFICATION_THREAD.POOLS_METADATA[block.creator].HASH=blockHash


        //___________________ Update the KLY-EVM ___________________

        let evmID = SYMBIOTE_META.VERIFICATION_THREAD.KLY_EVM_REASSIGN[subchainContext]

        if(evmID){

            let currentEVM = SYMBIOTE_META.KLY_EVM_PER_SUBCHAIN.get(evmID)

            let currentEVMMetadata = SYMBIOTE_META.VERIFICATION_THREAD.KLY_EVM_METADATA[evmID]
    
            // Update stateRoot
            currentEVMMetadata.STATE_ROOT = await currentEVM.getStateRoot()
    
            // Increase block index
            let nextIndex = BigInt(currentEVMMetadata.NEXT_BLOCK_INDEX)+BigInt(1)
    
            currentEVMMetadata.NEXT_BLOCK_INDEX = Web3.utils.toHex(nextIndex.toString())
    
            // Store previous hash
            let currentHash = currentEVM.getCurrentBlock().hash()
    
            currentEVMMetadata.PARENT_HASH = currentHash.toString('hex')
    
            // Imagine that it's 1 block per 2 seconds
            let nextTimestamp = currentEVMMetadata.TIMESTAMP+2
    
            currentEVMMetadata.TIMESTAMP = nextTimestamp

            let blockToStore = currentEVM.getBlockToStore(currentHash)


            atomicBatch.put(evmID+':EVM_BLOCK:'+blockToStore.number,blockToStore)

            atomicBatch.put(evmID+':EVM_INDEX:'+blockToStore.hash,blockToStore.number)
    
            atomicBatch.put(evmID+':EVM_LOGS:'+blockToStore.number,SYMBIOTE_META.STATE_CACHE.get(evmID+'EVM_LOGS_MAP'))
    
            atomicBatch.put(evmID+':EVM_BLOCK_RECEIPT:'+blockToStore.number,`BLOCK_CONTEXT:${currentBlockID}`)


            // Set the next block's parameters
            currentEVM.setCurrentBlockParams(nextIndex,nextTimestamp,currentHash)
        
            atomicBatch.put('BLOCK_RECEIPT:'+currentBlockID,{

                evmContext:evmID,

                rid:currentRID

            })

        }
        
        //Commit the state of VERIFICATION_THREAD

        atomicBatch.put('VT',SYMBIOTE_META.VERIFICATION_THREAD)

        await atomicBatch.write()
        

    }

}