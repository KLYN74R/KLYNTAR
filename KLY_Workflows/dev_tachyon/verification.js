import {
    
    GET_ACCOUNT_ON_SYMBIOTE,BLOCKLOG,BLS_VERIFY,GET_QUORUM,GET_FROM_STATE,
    
    GET_VALIDATORS_URLS,GET_ALL_KNOWN_PEERS,GET_MAJORITY,IS_MY_VERSION_OLD,CHECK_IF_THE_SAME_DAY

} from './utils.js'

import {LOG,SYMBIOTE_ALIAS,BLAKE3,GET_GMT_TIMESTAMP} from '../../KLY_Utils/utils.js'

import bls from '../../KLY_Utils/signatures/multisig/bls.js'

import OPERATIONS_VERIFIERS from './operationsVerifiers.js'

import Block from './essences/block.js'

import {GRACEFUL_STOP} from './life.js'

import fetch from 'node-fetch'
import { KLY_EVM } from '../../KLY_VMs/kly-evm/vm.js'
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
                
            if(typeof block.events==='object'&&typeof block.prevHash==='string'&&typeof block.sig==='string' && block.index===index && block.creator === blockCreator){
    
                BLOCKLOG(`New \x1b[36m\x1b[41;1mblock\x1b[0m\x1b[32m  fetched  \x1b[31m——│`,'S',hash,48,'\x1b[31m',block)

                SYMBIOTE_META.BLOCKS.put(blockID,block)
    
                return block
    
            }
    
        }).catch(async error=>{
    
            LOG(`No block \x1b[36;1m${blockCreator+":"+index}\u001b[38;5;3m for symbiote \x1b[36;1m${SYMBIOTE_ALIAS()}\u001b[38;5;3m ———> ${error}`,'W')
    
            LOG(`Going to ask for blocks from the other nodes(\x1b[32;1mGET_BLOCKS_URL\x1b[36;1m node is \x1b[31;1moffline\x1b[36;1m or another error occured)`,'I')
    

            //Combine all nodes we know about and try to find block there
            let allVisibleNodes=await GET_VALIDATORS_URLS()

    
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
    
                        BLOCKLOG(`New \x1b[36m\x1b[41;1mblock\x1b[0m\x1b[32m  fetched  \x1b[31m——│`,'S',hash,48,'\x1b[31m',itsProbablyBlock)

                        SYMBIOTE_META.BLOCKS.put(blockID,itsProbablyBlock).catch(_=>{})
    
                        return itsProbablyBlock
    
                    }
    
                }
    
            }
            
        })
    
    )

},




GET_SKIP_PROCEDURE_STAGE_3_PROOFS = async (qtPayload,subchain,index,hash) => {

    // Get the 2/3N+1 of current quorum that they've seen the SKIP_PROCEDURE_STAGE_2 on hostchain


    let quorumMembers = await GET_VALIDATORS_URLS(true)

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

        let afkValidators = SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT.QUORUM.filter(pub=>!pubKeys.includes(pub))

        let object={subchain,index,hash,aggregatedPub,aggregatedSignature,afkValidators}


        //Store locally in temp db
        await checkpointTempDB.put('SKIP_STAGE_3:'+subchain,object).catch(_=>false)

        return object

    }

},


/*

<SUPER_FINALIZATION_PROOF> is an aggregated proof from 2/3N+1 validators from quorum that they each have 2/3N+1 commitments from other validators

Structure => {
    
    blockID:"7GPupbq1vtKUgaqVeHiDbEJcxS7sSjwPnbht4eRaDBAEJv8ZKHNCSu2Am3CuWnHjta:0",

    blockHash:"0123456701234567012345670123456701234567012345670123456701234567",

    aggregatedPub:"7cBETvyWGSvnaVbc7ZhSfRPYXmsTzZzYmraKEgxQMng8UPEEexpvVSgTuo8iza73oP",

    aggregatedSigna:"kffamjvjEg4CMP8VsxTSfC/Gs3T/MgV1xHSbP5YXJI5eCINasivnw07f/lHmWdJjC4qsSrdxr+J8cItbWgbbqNaM+3W4HROq2ojiAhsNw6yCmSBXl73Yhgb44vl5Q8qD",

    afkValidators:[]

}

********************************************** ONLY AFTER VERIFICATION OF SUPER_FINALIZATION_PROOF YOU CAN PROCESS THE BLOCK **********************************************

Verification process:

    Saying, you need to get proofs to add some block 1337th generated by validator Andy with hash "cafe..."

    Once you find the candidate for SUPER_FINALIZATION_PROOF , you should verify

        [+] let shouldAccept = await VERIFY(aggregatedPub,aggregatedSigna,"Andy:1337"+":cafe:"+'FINALIZATION')

            Also, check if QUORUM_AGGREGATED_PUB === AGGREGATE(aggregatedPub,afkValidators)

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

        //Structure is {index,hash,aggregatedPub,aggregatedSignature,afkValidators}
        let skipStage3Proof = await checkpointTemporaryDB.get('SKIP_STAGE_3:'+subchain).catch(_=>false) || await GET_SKIP_PROCEDURE_STAGE_3_PROOFS(qtPayload,subchain,skipStage2Data.INDEX,skipStage2Data.HASH).catch(_=>false)

        //{INDEX,HASH,IS_STOPPED}
        let currentMetadata = SYMBIOTE_META.VERIFICATION_THREAD.SUBCHAINS_METADATA[subchain]


        // Initially, check if subchain was stopped from this height:hash on this checkpoint
        if(skipStage3Proof && skipStage3Proof.index === currentMetadata.INDEX && skipStage3Proof.hash === currentMetadata.HASH){
    
            //Stop this subchain for the next iterations
            let successWrite = await checkpointTemporaryDB.put('FINAL_SKIP_STAGE_3:'+subchain,true).then(()=>true).catch(_=>false)

            if(successWrite) return {skip:true,verify:false}
             
        }    

    }

    
    let superFinalizationProof = await checkpointTemporaryDB.get('SFP:'+blockID+blockHash).catch(_=>false)


    //We shouldn't verify local version of SFP, because we already did it. See the GET /get_super_finalization route handler
    
    if(superFinalizationProof) return {skip:false,verify:true}
    

    //Go through known hosts and find SUPER_FINALIZATION_PROOF. Call /get_super_finalization route
    
    let quorumMembersURLs = [CONFIG.SYMBIOTE.GET_SUPER_FINALIZATION_PROOF_URL,...await GET_VALIDATORS_URLS(),...GET_ALL_KNOWN_PEERS()]


    for(let memberURL of quorumMembersURLs){


        let itsProbablySuperFinalizationProof = await fetch(memberURL+'/get_super_finalization/'+blockID+blockHash).then(r=>r.json()).catch(_=>false),

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
                                    Array.isArray(itsProbablySuperFinalizationProof.afkValidators)


        if(generalAndTypeCheck){

            //Verify it before return

            let qtPayload = SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.HEADER.PAYLOAD_HASH+SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.HEADER.ID


            let aggregatedSignatureIsOk = await BLS_VERIFY(blockID+blockHash+'FINALIZATION'+qtPayload,itsProbablySuperFinalizationProof.aggregatedSignature,itsProbablySuperFinalizationProof.aggregatedPub),

                rootQuorumKeyIsEqualToProposed = SYMBIOTE_META.STATIC_STUFF_CACHE.get('VT_ROOTPUB') === bls.aggregatePublicKeys([itsProbablySuperFinalizationProof.aggregatedPub,...itsProbablySuperFinalizationProof.afkValidators]),

                quorumSize = SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.QUORUM.length,

                majority = GET_MAJORITY('VERIFICATION_THREAD')

            
            let majorityVotedForThis = quorumSize-itsProbablySuperFinalizationProof.afkValidators.length >= majority


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

    poolStorage.storedMetadata=SYMBIOTE_META.VERIFICATION_THREAD.SUBCHAINS_METADATA[validatorPubKey]


    delete SYMBIOTE_META.VERIFICATION_THREAD.SUBCHAINS_METADATA[validatorPubKey]

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


        let poolsToBeRemoved = [], promises = [], subchainsArray = Object.keys(SYMBIOTE_META.VERIFICATION_THREAD.SUBCHAINS_METADATA)

        for(let validator of subchainsArray){

            let promise = GET_FROM_STATE(validator+'(POOL)_STORAGE_POOL').then(poolStorage=>{

                if(poolStorage.totalPower<SYMBIOTE_META.VERIFICATION_THREAD.WORKFLOW_OPTIONS.VALIDATOR_STAKE) poolsToBeRemoved.push(validator)

            })

            promises.push(promise)

        }

        await Promise.all(promises.splice(0))

        //Now in toRemovePools we have IDs of pools which should be deleted from VALIDATORS

        let deleteValidatorsPoolsPromises=[]

        for(let poolBLSAddress of poolsToBeRemoved){

            deleteValidatorsPoolsPromises.push(DELETE_VALIDATOR_POOLS_WHICH_HAVE_LACK_OF_STAKING_POWER(poolBLSAddress))

        }

        await Promise.all(deleteValidatorsPoolsPromises.splice(0))


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

            // Remove from subchains
            delete SYMBIOTE_META.VERIFICATION_THREAD.SUBCHAINS_METADATA[poolIdentifier]

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
                        if(delayedTX.units==='KLY') account.balance += delayedTX.amount

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
       
        //Create new quorum based on new SUBCHAINS_METADATA state
        SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.QUORUM = GET_QUORUM(SYMBIOTE_META.VERIFICATION_THREAD.SUBCHAINS_METADATA,SYMBIOTE_META.VERIFICATION_THREAD.WORKFLOW_OPTIONS)

        //Get the new rootpub
        SYMBIOTE_META.STATIC_STUFF_CACHE.set('VT_ROOTPUB',bls.aggregatePublicKeys(SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.QUORUM))


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


        if(nextCheckpoint) {


            let oldQuorum = SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.QUORUM

            //Set the new checkpoint
            SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT=nextCheckpoint

            // But quorum is the same as previous
            SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.QUORUM = oldQuorum

            //Get the new rootpub
            SYMBIOTE_META.STATIC_STUFF_CACHE.set('VT_ROOTPUB',bls.aggregatePublicKeys(SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.QUORUM))


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




START_VERIFICATION_THREAD=async()=>{

    //This option will stop workflow of verification for each symbiote
    
    if(!SYSTEM_SIGNAL_ACCEPTED){

        //_______________________________ Check if we reach checkpoint stats to find out next one and continue work on VT _______________________________

        let currentSubchainsMetadataHash = BLAKE3(JSON.stringify(SYMBIOTE_META.VERIFICATION_THREAD.SUBCHAINS_METADATA)),

            subchainsMetadataHashFromCheckpoint = BLAKE3(JSON.stringify(SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.PAYLOAD.SUBCHAINS_METADATA))

        

        //If we reach the limits of current checkpoint - find another one. In case there are no more checkpoints - mark current checkpoint as "completed"
        await SET_UP_NEW_CHECKPOINT(currentSubchainsMetadataHash === subchainsMetadataHashFromCheckpoint,SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.COMPLETED)


        //Updated checkpoint on previous step might be old or fresh,so we should update the variable state

        let updatedIsFreshCheckpoint = CHECK_IF_THE_SAME_DAY(SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.TIMESTAMP,GET_GMT_TIMESTAMP())


        /*

            ! Glossary - SUPER_FINALIZATION_PROOF on high level is proof that for block Y created by validator PubX with hash H exists at least 2/3N+1 validators who has 2/3N+1 commitments for this block

                [+] If our current checkpoint are "too old", no sense to find SUPER_FINALIZATION_PROOF. Just find & process block
        
                [+] If latest checkpoint was created & published on hostchains(primary and other hostchains via HiveMind) we should find SUPER_FINALIZATION_PROOF to proceed the block
        

        */
        

        let prevSubchainWeChecked = SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.SUBCHAIN,

            validatorsPool = Object.keys(SYMBIOTE_META.VERIFICATION_THREAD.SUBCHAINS_METADATA),

            //take the next validator in a row. If it's end of validators pool - start from the first validator in array
            currentSubchainToCheck = validatorsPool[validatorsPool.indexOf(prevSubchainWeChecked)+1] || validatorsPool[0],

            //We receive {INDEX,HASH,IS_STOPPED} - it's data from previously checked blocks on this validators' track. We're going to verify next block(INDEX+1)
            currentSessionMetadata = SYMBIOTE_META.VERIFICATION_THREAD.SUBCHAINS_METADATA[currentSubchainToCheck],

            blockID = currentSubchainToCheck+":"+(currentSessionMetadata.INDEX+1),

            //take the next validator in a row. If it's end of validators pool - start from the first validator
            nextValidatorToCheck=validatorsPool[validatorsPool.indexOf(currentSubchainToCheck)+1] || validatorsPool[0],

            nextBlock,//to verify next block ASAP if it's available

            shouldSkip = false


        //If current validator was marked as "offline" or AFK - skip his blocks till his activity signals
        //Change the state of validator activity only via checkpoints

        
        if(currentSessionMetadata.IS_STOPPED){

            /*
            
                Here we do everything to skip this block and move to the next subchains's block
                        
                If 2/3+1 validators have voted to "skip" block - we take the "NEXT+1" block and continue work in verification thread
                    
                Here we just need to change finalized pointer to imitate that "skipped" block was successfully checked and next validator's block should be verified(in the next iteration)

            */

                
            SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.SUBCHAIN=currentSubchainToCheck

            SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.INDEX=currentSessionMetadata.INDEX+1
                                    
            SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.HASH='Sleep,the brother of Death @ Homer'


        }else {

            //If block creator is active and produce blocks or it's non-fresh checkpoint - we can get block and process it

            let block = await GET_BLOCK(currentSubchainToCheck,currentSessionMetadata.INDEX+1),

                blockHash = block && Block.genHash(block),

                quorumSolutionToVerifyBlock = false, //by default

                currentBlockPresentInCurrentCheckpoint = SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.PAYLOAD.SUBCHAINS_METADATA[currentSubchainToCheck]?.INDEX > currentSessionMetadata.INDEX,

                checkPointCompleted  = SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.COMPLETED
        
            

            if(currentBlockPresentInCurrentCheckpoint){

                quorumSolutionToVerifyBlock = true

            }
        
            else if(!checkPointCompleted) {

                //if no sush block in current uncompleted checkpoint - then we need to skip it.
                shouldSkip = true

            }

            else if(updatedIsFreshCheckpoint){

                let {skip,verify} = await GET_SUPER_FINALIZATION_PROOF(blockID,blockHash).catch(_=>({skip:false,verify:false}))

                quorumSolutionToVerifyBlock = verify

                shouldSkip = skip
            
            }


            let pointerThatVerificationWasSuccessful = currentSessionMetadata.INDEX+1 //if the id will be increased - then the block was verified and we can move on 

            //We skip the block if checkpoint is not completed and no such block in checkpoint
            //No matter if checkpoint is fresh or not
            
            
            if(shouldSkip){

                SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.SUBCHAIN=currentSubchainToCheck

                SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.INDEX=currentSessionMetadata.INDEX+1
                                        
                SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.HASH='Sleep,the brother of Death @ Homer'


            }else if(block && quorumSolutionToVerifyBlock){

                await verifyBlock(block)
            
                //Signal that verification was successful
                if(SYMBIOTE_META.VERIFICATION_THREAD.SUBCHAINS_METADATA[currentSubchainToCheck].INDEX===pointerThatVerificationWasSuccessful){
                
                    nextBlock=await GET_BLOCK(nextValidatorToCheck,SYMBIOTE_META.VERIFICATION_THREAD.SUBCHAINS_METADATA[nextValidatorToCheck].INDEX+1)
                
                }

                LOG(`Local VERIFICATION_THREAD state is \x1b[32;1m${SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.SUBCHAIN} \u001b[38;5;168m}———{\x1b[32;1m ${SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.INDEX} \u001b[38;5;168m}———{\x1b[32;1m ${SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.HASH}\n`,'I')
                    
                // If verification failed - delete block. It will force to find another(valid) block from network
                // else SYMBIOTE_META.BLOCKS.del(currentValidatorToCheck+':'+(currentSessionMetadata.INDEX+1)).catch(e=>{})
                
            }

        }


        if(CONFIG.SYMBIOTE.STOP_VERIFY) return//step over initiation of another timeout and this way-stop the Verification Thread

        //If next block is available-instantly start perform.Otherwise-wait few seconds and repeat request

        // let shouldImmediatelyContinue = nextBlock||shouldSkip||currentSessionMetadata.IS_STOPPED


        setTimeout(START_VERIFICATION_THREAD,0)

    
    }else{

        LOG(`Polling for \x1b[32;1m${SYMBIOTE_ALIAS()}\x1b[36;1m was stopped`,'I',CONFIG.SYMBIOTE.SYMBIOTE_ID)

    }

},




SHARE_FEES_AMONG_STAKERS=async(poolId,feeToPay)=>{

    let mainStorageOfPool = await GET_FROM_STATE(poolId+'(POOL)_STORAGE_POOL')

    if(mainStorageOfPool.percentage!==0){

        //Get the pool percentage and send to appropriate BLS address
        let poolBindedBLSPubKey = await GET_ACCOUNT_ON_SYMBIOTE(poolId)

        poolBindedBLSPubKey.balance += mainStorageOfPool.percentage*feeToPay
        
    }

    let restOfFees = feeToPay - mainStorageOfPool.percentage*feeToPay

    //Iteration over the {KLY,UNO,REWARD}
    Object.values(mainStorageOfPool.STAKERS).forEach(stakerStats=>{

        let stakerTotalPower = stakerStats.UNO + stakerStats.KLY

        let totalStakerPowerPercent = stakerTotalPower/mainStorageOfPool.totalPower

        stakerStats.REWARD+=totalStakerPowerPercent*restOfFees

    })

},




//Function to distribute stakes among validators/blockCreator/staking pools
DISTRIBUTE_FEES=async(totalFees,blockCreator)=>{

    /*

        _____________________Here we perform the following logic_____________________

        [*] totalFees - number of total fees received in this block



        1) Take all the validators from SYMBIOTE_META.VERIFICATION_THREAD.SUBCHAINS

        2) Send REWARD_PERCENTAGE_FOR_BLOCK_CREATOR * totalFees to block creator

        3) Distribute the rest among all the other validators(excluding block creator)

            For this, we should:

            3.1) Take the pool storage from state by id = validatorPubKey+'(POOL)_STORAGE_POOL'

            3.2) Run the cycle over the POOL.STAKERS(structure is STAKER_PUBKEY => {KLY,UNO,REWARD}) and increase reward by FEES_FOR_THIS_VALIDATOR * ( STAKER_POWER_IN_UNO / TOTAL_POOL_POWER )

    
    */

    let payToCreatorAndHisPool = totalFees * SYMBIOTE_META.VERIFICATION_THREAD.WORKFLOW_OPTIONS.REWARD_PERCENTAGE_FOR_BLOCK_CREATOR, //the bigger part is usually for block creator

        subchainsArray = Object.keys(SYMBIOTE_META.VERIFICATION_THREAD.SUBCHAINS_METADATA),

        payToEachPool = Math.floor((totalFees - payToCreatorAndHisPool)/(subchainsArray.length-1)), //and share the rest among other validators
    
        shareFeesPromises = []

          
    if(subchainsArray.length===1) payToEachPool = totalFees - payToCreatorAndHisPool


    //___________________________________________ BLOCK_CREATOR ___________________________________________

    shareFeesPromises.push(SHARE_FEES_AMONG_STAKERS(blockCreator,payToCreatorAndHisPool))

    //_____________________________________________ THE REST ______________________________________________

    subchainsArray.forEach(poolPubKey=>

        poolPubKey !== blockCreator && shareFeesPromises.push(SHARE_FEES_AMONG_STAKERS(poolPubKey,payToEachPool))
            
    )
     
    await Promise.all(shareFeesPromises.splice(0))

},




verifyBlock=async block=>{


    let blockHash=Block.genHash(block),

        overviewOk=
    
            block.events?.length<=SYMBIOTE_META.VERIFICATION_THREAD.WORKFLOW_OPTIONS.EVENTS_LIMIT_PER_BLOCK
            &&
            SYMBIOTE_META.VERIFICATION_THREAD.SUBCHAINS_METADATA[block.creator].HASH === block.prevHash//it should be a chain
            &&
            await BLS_VERIFY(blockHash,block.sig,block.creator)


    // if(block.i === CONFIG.SYMBIOTE.SYMBIOTE_CHECKPOINT.HEIGHT && blockHash !== CONFIG.SYMBIOTE.SYMBIOTE_CHECKPOINT.HEIGHT){

    //     LOG(`SYMBIOTE_CHECKPOINT verification failed. Delete the CHAINDATA/BLOCKS,CHAINDATA/METADATA,CHAINDATA/STATE and SNAPSHOTS. Resync node with the right blockchain or load the true snapshot`,'F')

    //     LOG('Going to stop...','W')

    //     process.emit('SIGINT')

    // }


    if(overviewOk){


        //To calculate fees and split between validators.Currently - general fees sum is 0. It will be increased each performed transaction
        let rewardBox={fees:0}


        //To change the state atomically
        let atomicBatch = SYMBIOTE_META.STATE.batch()

        //_________________________________________GET ACCOUNTS FROM STORAGE____________________________________________
        
        let sendersAccounts=[]
    
        //Push accounts of validators
        Object.keys(SYMBIOTE_META.VERIFICATION_THREAD.SUBCHAINS_METADATA).forEach(pubKey=>sendersAccounts.push(GET_ACCOUNT_ON_SYMBIOTE(pubKey)))


        //Now cache has all accounts and ready for the next cycles
        await Promise.all(sendersAccounts.splice(0))


        //___________________________________________START TO PERFORM EVENTS____________________________________________

        for(let event of block.events){

            if(SYMBIOTE_META.VERIFIERS[event.type]) await SYMBIOTE_META.VERIFIERS[event.type](event,rewardBox,atomicBatch)

        }

        //__________________________________________SHARE FEES AMONG VALIDATORS_________________________________________
        
        await DISTRIBUTE_FEES(rewardBox.fees,block.creator)


        //Probably you would like to store only state or you just run another node via cloud module and want to store some range of blocks remotely
        if(CONFIG.SYMBIOTE.STORE_BLOCKS){
            
            //No matter if we already have this block-resave it

            SYMBIOTE_META.BLOCKS.put(block.creator+":"+block.index,block).catch(error=>LOG(`Failed to store block ${block.index} on ${SYMBIOTE_ALIAS()}\nError:${error}`,'W'))

        }else if(block.creator!==CONFIG.SYMBIOTE.PUB){

            //...but if we shouldn't store and have it locally(received probably by range loading)-then delete
            SYMBIOTE_META.BLOCKS.del(block.creator+":"+block.index).catch(
                
                error => LOG(`Failed to delete block ${block.index} on ${SYMBIOTE_ALIAS()}\nError:${error}`,'W')
                
            )

        }


        //________________________________________________COMMIT STATE__________________________________________________    


        SYMBIOTE_META.STATE_CACHE.forEach((account,addr)=>

            atomicBatch.put(addr,account)

        )
        
        if(SYMBIOTE_META.STATE_CACHE.size>=CONFIG.SYMBIOTE.BLOCK_TO_BLOCK_CACHE_SIZE) SYMBIOTE_META.STATE_CACHE.clear()//flush cache.NOTE-some kind of advanced upgrade soon



        //Change finalization pointer
        
        SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.SUBCHAIN=block.creator

        SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.INDEX=block.index
                
        SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.HASH=blockHash

        
        //Change metadata per validator's thread
        
        SYMBIOTE_META.VERIFICATION_THREAD.SUBCHAINS_METADATA[block.creator].INDEX=block.index

        SYMBIOTE_META.VERIFICATION_THREAD.SUBCHAINS_METADATA[block.creator].HASH=blockHash

        //___________________ Update the KLY-EVM ___________________

        // Update stateRoot
        SYMBIOTE_META.VERIFICATION_THREAD.KLY_EVM_META.STATE_ROOT = await KLY_EVM.getStateRoot()

        // Increase block index
        let nextIndex = BigInt(SYMBIOTE_META.VERIFICATION_THREAD.KLY_EVM_META.NEXT_BLOCK_INDEX)+BigInt(1)

        SYMBIOTE_META.VERIFICATION_THREAD.KLY_EVM_META.NEXT_BLOCK_INDEX = Web3.utils.toHex(nextIndex.toString())

        // Store previous hash
        let currentHash = KLY_EVM.getCurrentBlock().hash()

        SYMBIOTE_META.VERIFICATION_THREAD.KLY_EVM_META.PARENT_HASH = currentHash.toString('hex')

        // Imagine that it's 1 block per 2 seconds
        let nextTimestamp = SYMBIOTE_META.VERIFICATION_THREAD.KLY_EVM_META.TIMESTAMP+2

        SYMBIOTE_META.VERIFICATION_THREAD.KLY_EVM_META.TIMESTAMP = nextTimestamp

        /*

                        Now, we need to store block

        ______________________Block must have______________________
    
        ✅number: QUANTITY - the block number. null when its pending block.
        ⌛️hash: DATA, 32 Bytes - hash of the block. null when its pending block.
        ✅parentHash: DATA, 32 Bytes - hash of the parent block.
        ✅nonce: DATA, 8 Bytes - hash of the generated proof-of-work. null when its pending block.
        ✅sha3Uncles: DATA, 32 Bytes - SHA3 of the uncles data in the block.
        ✅transactionsRoot: DATA, 32 Bytes - the root of the transaction trie of the block.
        ✅stateRoot: DATA, 32 Bytes - the root of the final state trie of the block.
        ✅receiptsRoot: DATA, 32 Bytes - the root of the receipts trie of the block.
        ✅miner: DATA, 20 Bytes - the address of the beneficiary to whom the mining rewards were given.
        ✅difficulty: QUANTITY - integer of the difficulty for this block.
        ⌛️totalDifficulty: QUANTITY - integer of the total difficulty of the chain until this block.
        ✅extraData: DATA - the "extra data" field of this block.
        ✅logsBloom: DATA, 256 Bytes - the bloom filter for the logs of the block. null when its pending block.
        ✅gasLimit: QUANTITY - the maximum gas allowed in this block.
        ✅gasUsed: QUANTITY - the total used gas by all transactions in this block.
        ✅timestamp: QUANTITY - the unix timestamp for when the block was collated.
        ✅transactions: Array - Array of transaction objects, or 32 Bytes transaction hashes depending on the last given parameter.
        ✅uncles: Array - Array of uncle hashes.
        ⌛️size: QUANTITY - integer the size of this block in bytes.
        

        ________________________Current________________________
        
        {
            header: {
                parentHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
                uncleHash: '0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347',
                coinbase: '0x0000000000000000000000000000000000000000',
                stateRoot: '0x0000000000000000000000000000000000000000000000000000000000000000',
                transactionsTrie: '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421',
                receiptTrie: '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421',
                logsBloom: '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                difficulty: '0x0',
                number: '0x0',
                gasLimit: '0xffffffffffffff',
                gasUsed: '0x0',
                timestamp: '0x1f21f020c9',
                extraData: '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                mixHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
                nonce: '0x0000000000000000'
            },

            transactions: [],
            uncleHeaders: []
        }


        _________________________TODO__________________________

        ✅hash - '0x'+block.hash.toString('hex')
        ✅uncleHash => sha3Uncles
        ✅transactionsTrie => transactionsRoot
        ✅receiptTrie => receiptsRoot
        ✅coinbase => miner
        ✅totalDifficulty - '0x0'
        size - '0x'
        ✅transactions - push the hashes of txs runned in this block
        ✅uncleHeaders => uncles[]


    */
            

        let currentBlock = KLY_EVM.getCurrentBlock()

        let {number,parentHash,nonce,uncleHash,transactionsTrie,receiptTrie,coinbase,stateRoot,difficulty,logsBloom,gasLimit,gasUsed,mixHash,extraData} = currentBlock.header

        let blockTemplate = {

            number:Web3.utils.toHex(number.toString()),
            hash:'0x'+currentHash.toString('hex'),
            
            parentHash:'0x'+parentHash.toString('hex'),
            nonce:'0x'+nonce.toString('hex'),

            extraData:'0x'+extraData.toString('hex'),
            
            sha3Uncles:'0x'+uncleHash.toString('hex'),
            transactionsRoot:'0x'+transactionsTrie.toString('hex'),
            receiptsRoot:'0x'+receiptTrie.toString('hex'),
            stateRoot:'0x'+stateRoot.toString('hex'),
            
            miner:coinbase.toString(),
            
            gasLimit:Web3.utils.toHex(gasLimit.toString()),
            gasUsage:Web3.utils.toHex(gasUsed.toString()),
            
            logsBloom:'0x'+logsBloom.toString('hex'),
            
            totalDifficulty:'0x0',
            difficulty:Web3.utils.toHex(difficulty.toString()),

            mixHash:'0x'+mixHash.toString('hex'),

            transactions:[],
            uncleHeaders:[]

        }

        atomicBatch.put('EVM_BLOCK:'+blockTemplate.number,blockTemplate)

        atomicBatch.put('EVM_INDEX:'+blockTemplate.hash,blockTemplate.number)

        

        // Set the next block's parameters
    
        KLY_EVM.setCurrentBlockParams(nextIndex,nextTimestamp,currentHash)

        
        //Commit the state of VERIFICATION_THREAD

        atomicBatch.put('VT',SYMBIOTE_META.VERIFICATION_THREAD)

        await atomicBatch.write()
        

    }

}