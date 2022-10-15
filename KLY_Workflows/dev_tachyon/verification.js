import {GET_ACCOUNT_ON_SYMBIOTE,BLOCKLOG,VERIFY} from './utils.js'

import {LOG,SYMBIOTE_ALIAS,BLAKE3} from '../../KLY_Utils/utils.js'

import MESSAGE_VERIFIERS from './messagesVerifiers.js'

import Block from './essences/block.js'

import fetch from 'node-fetch'




global.GETTING_BLOCK_FROM_NETWORK_PROCESS=false




//_____________________________________________________________EXPORT SECTION____________________________________________________________________




export let



//blocksAndProofs - array like this [{b:blockX,p:Proof_for_blockX}, {b:blockY,p:Proof_for_blockY}, ...]
PERFORM_BLOCK_MULTISET=blocksAndProofs=>{

    blocksAndProofs.forEach(
            
        //blockAndProof - {b:<block object>,p:<proof object>}
        async blockAndProof => {
    
            let {b:block,p:bftProof} = blockAndProof,
    
                blockHash=Block.genHash(block.creator,block.time,block.events,block.index,block.prevHash)
    
            if(await VERIFY(blockHash,block.sig,block.c)){
    
                SYMBIOTE_META.BLOCKS.put(block.c+":"+block.i,block).catch(e=>{})
    
            }
    
            if(bftProof) SYMBIOTE_META.VALIDATORS_COMMITMENTS.put(block.c+":"+block.i,bftProof).catch(e=>{})
    
        }
    
    )

    //Reset flag
    GETTING_BLOCK_FROM_NETWORK_PROCESS=false

},




/*

? Initially we ask blocks from CONFIG.SYMBIOTE.GET_MULTI node. It might be some CDN service, special API, private fast node and so on

We need to send an array of block IDs e.g. [Validator1:1337,Validator2:1337,Validator3:1337,Validator1337:1337, ... ValidatorX:2294]

*/

GET_BLOCKS_FOR_FUTURE = () => {

    //Set locker
    global.GETTING_BLOCK_FROM_NETWORK_PROCESS=true


    let blocksIDs=[],

        currentValidators=SYMBIOTE_META.VERIFICATION_THREAD.VALIDATORS,
    
        limitedPool = currentValidators.slice(0,CONFIG.SYMBIOTE.GET_MULTIPLY_BLOCKS_LIMIT)

    
    if(CONFIG.SYMBIOTE.GET_MULTIPLY_BLOCKS_LIMIT>currentValidators.length){

        let perValidator = Math.floor(CONFIG.SYMBIOTE.GET_MULTIPLY_BLOCKS_LIMIT/currentValidators.length)

        for(let index=0;index<perValidator;index++){

            for(let validator of currentValidators){

                if(validator===CONFIG.SYMBIOTE.PUB) continue

                blocksIDs.push(validator+":"+(SYMBIOTE_META.VERIFICATION_THREAD.VALIDATORS_METADATA[validator].INDEX+index))

            }

        }


    }else{

        //If number of validators is bigger than our configurated limit to ask in advance blocks, then we ask 1 block per validator(according to VERIFICATION_THREAD state)
        for(let validator of limitedPool) blocksIDs.push(validator+":"+(SYMBIOTE_META.VERIFICATION_THREAD.VALIDATORS_METADATA[validator].INDEX+1))

    }    


    let blocksIDsInJSON = JSON.stringify(blocksIDs)

 
    fetch(CONFIG.SYMBIOTE.GET_MULTI+`/multiplicity`,{
    
        method:'POST',
    
        body: blocksIDsInJSON
    
    
    }).then(r=>r.json()).then(PERFORM_BLOCK_MULTISET).catch(async error=>{
        
        LOG(`Some problem when load multiplicity of blocks on \x1b[32;1m${SYMBIOTE_ALIAS()}\n${error}`,'I')
    
        LOG(`Going to ask for blocks from the other nodes(\x1b[32;1mGET_MULTI\x1b[36;1m node is \x1b[31;1moffline\x1b[36;1m or another error occured)`,'I')

        //Combine all nodes we know about and try to find block there
        let allVisibleNodes=[...CONFIG.SYMBIOTE.BOOTSTRAP_NODES,...SYMBIOTE_META.PEERS]


        for(let url of allVisibleNodes){

            let itsProbablyArrayOfBlocksAndProofs=await fetch(url+'/multiplicity',{method:'POST',body:blocksIDsInJSON}).then(r=>r.json()).catch(e=>false)

            if(itsProbablyArrayOfBlocksAndProofs){

                PERFORM_BLOCK_MULTISET(itsProbablyArrayOfBlocksAndProofs)

                break
                
            }

        }

        //Reset flag
        GETTING_BLOCK_FROM_NETWORK_PROCESS=false

    })

},




GET_BLOCKS_FOR_FUTURE_WRAPPER = async() => {

    !GETTING_BLOCK_FROM_NETWORK_PROCESS //if flag is not disabled - then we still find blocks in another thread
    &&
    await GET_BLOCKS_FOR_FUTURE()

    setTimeout(GET_BLOCKS_FOR_FUTURE_WRAPPER,CONFIG.SYMBIOTE.GET_BLOCKS_FOR_FUTURE_TIMEOUT)

},




//Make all advanced stuff here-check block locally or ask from "GET_BLOCKS_URL" node for new blocks
//If no answer - try to find blocks somewhere else

GET_BLOCK = (blockCreator,index) => {

    let blockID=blockCreator+":"+index

    
    return SYMBIOTE_META.BLOCKS.get(blockID).catch(e=>

        fetch(CONFIG.SYMBIOTE.GET_BLOCKS_URL+`/block/`+blockCreator+":"+index)
    
        .then(r=>r.json()).then(block=>{
    
            let hash=Block.genHash(block.creator,block.time,block.events,block.index,block.prevHash)
                
            if(typeof block.e==='object'&&typeof block.p==='string'&&typeof block.sig==='string' && block.i===index && block.c === blockCreator){
    
                BLOCKLOG(`New \x1b[36m\x1b[41;1mblock\x1b[0m\x1b[32m  fetched  \x1b[31m——│`,'S',hash,48,'\x1b[31m',block)

                SYMBIOTE_META.BLOCKS.put(blockID,block)
    
                return block
    
            }
    
        }).catch(async error=>{
    
            LOG(`No block \x1b[36;1m${blockCreator+":"+index}\u001b[38;5;3m for symbiote \x1b[36;1m${SYMBIOTE_ALIAS()}\u001b[38;5;3m ———> ${error}`,'W')
    
            LOG(`Going to ask for blocks from the other nodes(\x1b[32;1mGET_BLOCKS_URL\x1b[36;1m node is \x1b[31;1moffline\x1b[36;1m or another error occured)`,'I')
    
            //Combine all nodes we know about and try to find block there
            let allVisibleNodes=[CONFIG.SYMBIOTE.GET_MULTI,...CONFIG.SYMBIOTE.BOOTSTRAP_NODES,...SYMBIOTE_META.PEERS]
            
    
            for(let url of allVisibleNodes){

                if(url===CONFIG.SYMBIOTE.MY_HOSTNAME) continue
                
                let itsProbablyBlock=await fetch(url+`/block/`+blockID).then(r=>r.json()).catch(e=>false)
                
                if(itsProbablyBlock){
    
                    let hash=Block.genHash(itsProbablyBlock.creator,itsProbablyBlock.time,itsProbablyBlock.events,itsProbablyBlock.index,itsProbablyBlock.prevHash)
                
                    if(typeof itsProbablyBlock.e==='object'&&typeof itsProbablyBlock.p==='string'&&typeof itsProbablyBlock.sig==='string' && itsProbablyBlock.i===index && itsProbablyBlock.c===blockCreator){
    
                        BLOCKLOG(`New \x1b[36m\x1b[41;1mblock\x1b[0m\x1b[32m  fetched  \x1b[31m——│`,'S',hash,48,'\x1b[31m',itsProbablyBlock)

                        SYMBIOTE_META.BLOCKS.put(blockID,itsProbablyBlock).catch(e=>{})
    
                        return itsProbablyBlock
    
                    }
    
                }
    
            }
            
        })
    
    )

},



CREATE_THE_MOST_SUITABLE_CHECKPOINT=async()=>{

    //Method which create checkpoint based on some logic & available FINALIZATION_PROOFS and SUPER_FINALIZATION_PROOFS

},



/*

<SUPER_FINALIZATION_PROOF> is an aggregated proof from 2/3N+1 validators from quorum that they each have 2/3N+1 commitments from other validators

Once some validator receive 2/3N+1 commitments for some block PubX:Y:H(block Y with hash H created by validator PubX) he generate signature

    [+] SIG(blockID+hash+"FINALIZATION")

This signature will be included to some object which called <FINALIZATION_PROOF>


Struture => {

    blockID:"7GPupbq1vtKUgaqVeHiDbEJcxS7sSjwPnbht4eRaDBAEJv8ZKHNCSu2Am3CuWnHjta:0",

    hash:"0123456701234567012345670123456701234567012345670123456701234567",
    
    validator:"7GPupbq1vtKUgaqVeHiDbEJcxS7sSjwPnbht4eRaDBAEJv8ZKHNCSu2Am3CuWnHjta", //creator of FINALIZATION_PROOF

    finalization_signa:SIG(blockID+hash+"FINALIZATION")

}

Then, validators from quorum exchange with these proofs and once you have 2/3N+1 you can build SUPER_FINALIZATION_PROOF using aggregation

Structure => {
    
    blockID:"7GPupbq1vtKUgaqVeHiDbEJcxS7sSjwPnbht4eRaDBAEJv8ZKHNCSu2Am3CuWnHjta:0",

    hash:"0123456701234567012345670123456701234567012345670123456701234567",

    aggregatedPub:"7cBETvyWGSvnaVbc7ZhSfRPYXmsTzZzYmraKEgxQMng8UPEEexpvVSgTuo8iza73oP",

    aggregatedSigna:"kffamjvjEg4CMP8VsxTSfC/Gs3T/MgV1xHSbP5YXJI5eCINasivnw07f/lHmWdJjC4qsSrdxr+J8cItbWgbbqNaM+3W4HROq2ojiAhsNw6yCmSBXl73Yhgb44vl5Q8qD",

    afkValidators:[]

}

********************************************** ONLY AFTER VERIFICATION OF SUPER_FINALIZATION_PROOF YOU CAN PROCESS THE BLOCK **********************************************

Verification process:

    Saying, you need to get proofs to add some block 1337th generated by validator Andy with hash "cafe..."

    Once you find the candidate for SUPER_FINALIZATION_PROOF , you should verify

        [+] let shouldAccept = await VERIFY(aggregatedPub,aggregatedSigna,"Andy:1337"+":cafe:"+"FINALIZATION")

            Also, check if QUORUM_AGGREGATED_PUB === AGGREGATE(aggregatedPub,afkValidators)

    If this both conditions is ok - then you can accept block with 100% garantee of irreversibility

*/
GET_SUPER_FINALIZATION_PROOF = async (blockId,blockHash) => {


},




START_VERIFICATION_THREAD=async()=>{

    //This option will stop workflow of verification for each symbiote
    
    if(!SYSTEM_SIGNAL_ACCEPTED){

        THREADS_STILL_WORKS.VERIFICATION=true

        // console.log(SYMBIOTE_META.VERIFICATION_THREAD)

        console.log(SYMBIOTE_META) //QUORUM_COMMITMENTS_CACHE also here


        //_______________________________ Check if we reach checkpoint stats to find out next one and continue work on VT _______________________________

        let currentValidatorsMetadataHash = BLAKE3(JSON.stringify(SYMBIOTE_META.VERIFICATION_THREAD.VALIDATORS_METADATA)),

            validatorsMetadataHashFromCheckpoint = BLAKE3(JSON.stringify(SYMBIOTE_META.VERIFICATION_THREAD.CURRENT_CHECKPOINT.PAYLOAD.VALIDATORS_METADATA))


        //Also, another reason to find new checkpoint if your current timestamp(UTC) related to the next day
        if(currentValidatorsMetadataHash===validatorsMetadataHashFromCheckpoint){

            //If equal - find new(next) checkpoint, verify it and follow it

            let nextCheckpoint = await HOSTCHAIN.MONITOR.GET_NEXT_VALID_CHECKPOINT(SYMBIOTE_META.VERIFICATION_THREAD.CURRENT_CHECKPOINT)

            SYMBIOTE_META.VERIFICATION_THREAD.CURRENT_CHECKPOINT=nextCheckpoint

        }


        let currentTimestamp = new Date().getTime()/1000,//due to UTC timestamp format

            checkpointIsFresh = HOSTCHAIN.MONITOR.CHECK_IF_THE_SAME_DAY(SYMBIOTE_META.VERIFICATION_THREAD.CURRENT_CHECKPOINT.TIMESTAMP,currentTimestamp)

        // console.log(currentValidatorsMetadataHash===validatorsMetadataHashFromCheckpoint)

        // console.log(checkpointIsFresh)

        
        /*

            ! Glossary - SUPER_FINALIZATION_PROOF on high level is proof that for block Y created by validator PubX with hash H exists at least 2/3N+1 validators who has 2/3N+1 commitments for this block

                [+] If our current checkpoint are "too old", no sense to find SUPER_FINALIZATION_PROOF. Just find & process block
        
                [+] If latest checkpoint was created & published on hostchains(primary and other hostchains via HiveMind) we should find SUPER_FINALIZATION_PROOF to proceed the block
        

        */
        

        let prevValidatorWeChecked = SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.VALIDATOR,

            validatorsPool=SYMBIOTE_META.VERIFICATION_THREAD.VALIDATORS,

            //take the next validator in a row. If it's end of validators pool - start from the first validator in array
            currentValidatorToCheck = validatorsPool[validatorsPool.indexOf(prevValidatorWeChecked)+1] || validatorsPool[0],

            //We receive {INDEX,HASH,ACTIVE} - it's data from previously checked blocks on this validators' track. We're going to verify next block(INDEX+1)
            currentSessionMetadata = SYMBIOTE_META.VERIFICATION_THREAD.VALIDATORS_METADATA[currentValidatorToCheck],

            blockID =  currentValidatorToCheck+":"+(currentSessionMetadata.INDEX+1),

            //take the next validator in a row. If it's end of validators pool - start from the first validator
            nextValidatorToCheck=validatorsPool[validatorsPool.indexOf(currentValidatorToCheck)+1] || validatorsPool[0],

            nextBlock//to verify block as fast as possible




        //If current validator was marked as "offline" or AFK - skip his blocks till his activity signals
        if(!currentSessionMetadata.BLOCKS_GENERATOR){

            /*
                    
                Here we do everything to skip this block and move to the next validator's block
                        
                If 2/3+1 validators have voted to "skip" block - we take the "NEXT+1" block and continue work in verification thread
                    
                Here we just need to change finalized pointer to imitate that "skipped" block was successfully checked and next validator's block should be verified(in the next iteration)

            */

                
            SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.VALIDATOR=currentValidatorToCheck

            SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.INDEX=currentSessionMetadata.INDEX+1
                                    
            SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.HASH='Sleep,the brother of Death @ Homer'


        }else {

            //Try to get block
            let block=await GET_BLOCK(currentValidatorToCheck,currentSessionMetadata.INDEX+1),

                blockHash = block && Block.genHash(block.creator,block.time,block.events,block.index,block.prevHash),

                quorumSolution = checkpointIsFresh ? await GET_SUPER_FINALIZATION_PROOF(blockID,blockHash) : {bftProofsIsOk:true,shouldSkip:false}
        


            if(quorumSolution.shouldSkip){

                /*
                        
                    Here we do everything to skip this block and move to the next validator's block
                            
                    If 2/3+1 validators have voted to "skip" block - we take the "NEXT+1" block and continue work in verification thread
                        
                    Here we just need to change finalized pointer to imitate that "skipped" block was successfully checked and next validator's block should be verified(in the next iteration)
    
                */

                currentSessionMetadata.BLOCKS_GENERATOR=false
    
                SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.VALIDATOR=currentValidatorToCheck

                SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.INDEX=currentSessionMetadata.INDEX+1
                                        
                SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.HASH='Sleep,the brother of Death @ Homer'

                LOG(`Going to skip \x1b[31;1m${currentValidatorToCheck}:${currentSessionMetadata.INDEX+1}`,'S')

    
            }else{
                
                let pointerThatVerificationWasSuccessful = currentSessionMetadata.INDEX+1 //if the id will be increased - then the block was verified and we can move on 

                if(block && quorumSolution.bftProofsIsOk){

                    await verifyBlock(block)
            
                    //Signal that verification was successful
                    if(SYMBIOTE_META.VERIFICATION_THREAD.VALIDATORS_METADATA[currentValidatorToCheck].INDEX===pointerThatVerificationWasSuccessful){
                
                        nextBlock=await GET_BLOCK(nextValidatorToCheck,SYMBIOTE_META.VERIFICATION_THREAD.VALIDATORS_METADATA[nextValidatorToCheck].INDEX+1)
                
                    }
                    //If verification failed - delete block. It will force to find another(valid) block from network
                    else SYMBIOTE_META.BLOCKS.del(currentValidatorToCheck+':'+(currentSessionMetadata.INDEX+1)).catch(e=>{})
                
                }
                
            }

        }



        if(CONFIG.SYMBIOTE.STOP_VERIFY) return//step over initiation of another timeout and this way-stop the Verification Thread

        //If next block is available-instantly start perform.Otherwise-wait few seconds and repeat request
        setTimeout(START_VERIFICATION_THREAD,(nextBlock||!currentSessionMetadata.BLOCKS_GENERATOR)?0:CONFIG.SYMBIOTE.VERIFICATION_THREAD_POLLING_INTERVAL)

        
        //Probably no sense to stop polling via .clearTimeout()
        //UPD:Do it to provide dynamic functionality for start/stop Verification Thread
        
        THREADS_STILL_WORKS.VERIFICATION=false

    
    }else{

        LOG(`Polling for \x1b[36;1m${SYMBIOTE_ALIAS()}\x1b[36;1m was stopped`,'I',CONFIG.SYMBIOTE.SYMBIOTE_ID)

        SIG_PROCESS.VERIFY=true

    }

},




MAKE_SNAPSHOT=async()=>{

    let {SNAPSHOT,STATE,VERIFICATION_THREAD}=SYMBIOTE_META//get appropriate dbs & descriptors of symbiote


    //_____________________________________________________Now we can make snapshot_____________________________________________________

    LOG(`Start making snapshot for ${SYMBIOTE_ALIAS()}`,'I')

    
    //Init atomic descriptor
    let atomicBatch = SNAPSHOT.batch()

    //Check if we should do full or partial snapshot.See https://github.com/KLYN74R/CIIPs
    if(CONFIG.SYMBIOTE.SNAPSHOTS.ALL){
        
        await new Promise(
        
            resolve => STATE.createReadStream()
            
                            .on('data',data=>atomicBatch.put(data.key,data.value))//add state of each account to snapshot dbs
            
                            .on('close',resolve)
            
        ).catch(e=>{
    
                LOG(`Snapshot creation failed on state copying stage for ${SYMBIOTE_ALIAS()}\n${e}`,'W')
                
                process.emit('SIGINT',130)
    
            })

    }else{

        //Read only part of state to make snapshot for backups
        //Set your own policy of backups with your other nodes,infrastructure etc.
        let choosen=JSON.parse(process.env.SNAPSHOTS_PATH+`/separation/${CONFIG.SYMBIOTE.SYMBIOTE_ID}.json`),
        
            getPromises=[]


        choosen.forEach(
            
            recordId => getPromises.push(
                
                STATE.get(recordId).then(
                    
                    acc => atomicBatch.put(recordId,acc)
                    
                )
                
            )
            
        )

        await Promise.all(getPromises.splice(0)).catch( e => {
    
            LOG(`Snapshot creation failed on getting choosen records for ${SYMBIOTE_ALIAS()}\n${e}`,'W')
            
            process.emit('SIGINT',130)

        })
        

    }
    



    await atomicBatch.write()
    
        .then(()=>LOG(`Snapshot was successfully created for \x1b[36;1m${SYMBIOTE_ALIAS()}\x1b[32;1m on point \x1b[36;1m${VERIFICATION_THREAD.FINALIZED_POINTER.HASH} ### ${VERIFICATION_THREAD.FINALIZED_POINTER.VALIDATOR}:${VERIFICATION_THREAD.FINALIZED_POINTER.INDEX}`,'S'))
        
        .catch(e=>{

            LOG(`Snapshot creation failed for ${SYMBIOTE_ALIAS()}\n${e}`,'W')
        
            process.emit('SIGINT',130)

        })


},




verifyBlock=async block=>{


    let blockHash=Block.genHash(block.creator,block.time,block.events,block.index,block.prevHash),


    overviewOk=
    
        block.e?.length<=CONFIG.SYMBIOTE.MANIFEST.WORKFLOW_OPTIONS.EVENTS_LIMIT_PER_BLOCK
        &&
        block.v?.length<=CONFIG.SYMBIOTE.MANIFEST.WORKFLOW_OPTIONS.VALIDATORS_STUFF_LIMIT_PER_BLOCK
        &&
        SYMBIOTE_META.VERIFICATION_THREAD.VALIDATORS_METADATA[block.c].HASH === block.p//it should be a chain
        &&
        await VERIFY(blockHash,block.sig,block.c)


    // if(block.i === CONFIG.SYMBIOTE.SYMBIOTE_CHECKPOINT.HEIGHT && blockHash !== CONFIG.SYMBIOTE.SYMBIOTE_CHECKPOINT.HEIGHT){

    //     LOG(`SYMBIOTE_CHECKPOINT verification failed. Delete the CHAINDATA/BLOCKS,CHAINDATA/METADATA,CHAINDATA/STATE and SNAPSHOTS. Resync node with the right blockchain or load the true snapshot`,'F')

    //     LOG('Going to stop...','W')

    //     process.emit('SIGINT')

    // }


    if(overviewOk){


        //To calculate fees and split between validators.Currently - general fees sum is 0. It will be increased each performed transaction
        let rewardBox={fees:0}


        //_________________________________________GET ACCOUNTS FROM STORAGE____________________________________________
        

        let sendersAccounts=[]
        
        //Go through each event,get accounts of initiators from state by creating promise and push to array for faster resolve
        block.e.forEach(event=>sendersAccounts.push(GET_ACCOUNT_ON_SYMBIOTE(event.c)))
        
        //Push accounts of validators
        SYMBIOTE_META.VERIFICATION_THREAD.VALIDATORS.forEach(pubKey=>sendersAccounts.push(GET_ACCOUNT_ON_SYMBIOTE(pubKey)))

        //Now cache has all accounts and ready for the next cycles
        await Promise.all(sendersAccounts.splice(0))


        //______________________________________CALCULATE TOTAL FEES AND AMOUNTS________________________________________


        block.e.forEach(event=>{

            //O(1),coz it's set
            if(!SYMBIOTE_META.BLACKLIST.has(event.c)){

                
                let acc=GET_ACCOUNT_ON_SYMBIOTE(event.c),
                    
                    spend=SYMBIOTE_META.SPENDERS[event.t]?.(event) || CONFIG.SYMBIOTE.MANIFEST.WORKFLOW_OPTIONS.DEFAULT_PAYMENT_IF_WRONG_TYPE



                        
                //If no such address-it's a signal that transaction can't be accepted
                if(!acc) return;
             
                (event.n<=acc.ACCOUNT.N||acc.NS.has(event.n)) ? acc.ND.add(event.n) : acc.NS.add(event.n);
    
                if((acc.OUT-=spend)<0 || !SYMBIOTE_META.SPENDERS[event.t] || event.p.r==='GT' || event.p.r==='VT') SYMBIOTE_META.BLACKLIST.add(event.c)

            }

        })


        //___________________________________________START TO PERFORM EVENTS____________________________________________

        
        let eventsPromises=[]


        block.e.forEach(event=>
                
            //If verifier to such event exsist-then verify it!
            SYMBIOTE_META.VERIFIERS[event.t]
            &&
            eventsPromises.push(SYMBIOTE_META.VERIFIERS[event.t](event,rewardBox))

        )
        
        await Promise.all(eventsPromises.splice(0))

        LOG(`Blacklist size(\u001b[38;5;177m${block.c+":"+block.i}\x1b[32;1m ### \u001b[38;5;177m${blockHash}\u001b[38;5;3m) ———> \x1b[36;1m${SYMBIOTE_META.BLACKLIST.size}`,'W')


        //____________________________________________PERFORM SYNC OPERATIONS___________________________________________

        // Some events must be synchronized

        //_______________________________________PERFORM VALIDATORS_STUFF OPERATIONS____________________________________

        // We need it for consensus too, so do it in a separate structure

        let validatorsStuffOperations = []


        for(let operation of block.v){

            validatorsStuffOperations.push(MESSAGE_VERIFIERS[operation.T]?.(operation,true).catch(e=>''))

        }


        await Promise.all(validatorsStuffOperations.splice(0))


        //__________________________________________SHARE FEES AMONG VALIDATORS_________________________________________
        

        let shareFeesPromises=[], 

            payToValidator = rewardBox.fees * CONFIG.SYMBIOTE.MANIFEST.WORKFLOW_OPTIONS.VALIDATOR_REWARD_PERCENTAGE, //the biggest part is usually delegated to creator of block
        
            payToSingleNonCreatorValidator = Math.floor((rewardBox.fees - payToValidator)/(SYMBIOTE_META.VERIFICATION_THREAD.VALIDATORS.length-1))//and share the rest among other validators




        SYMBIOTE_META.VERIFICATION_THREAD.VALIDATORS.forEach(validatorPubKey=>

            shareFeesPromises.push(

                GET_ACCOUNT_ON_SYMBIOTE(validatorPubKey).then(accountRef=>accountRef.ACCOUNT.B+=payToSingleNonCreatorValidator)

            )
            
        )
     
        await Promise.all(shareFeesPromises.splice(0))


        //Probably you would like to store only state or you just run another node via cloud module and want to store some range of blocks remotely
        if(CONFIG.SYMBIOTE.STORE_BLOCKS){
            
            //No matter if we already have this block-resave it

            SYMBIOTE_META.BLOCKS.put(block.c+":"+block.i,block).catch(e=>LOG(`Failed to store block ${block.i} on ${SYMBIOTE_ALIAS()}\nError:${e}`,'W'))

        }else{

            //...but if we shouldn't store and have it locally(received probably by range loading)-then delete
            SYMBIOTE_META.BLOCKS.del(block.c+":"+block.i).catch(
                
                e => LOG(`Failed to delete block ${block.i} on ${SYMBIOTE_ALIAS()}\nError:${e}`,'W')
                
            )

        }


        //________________________________________________COMMIT STATE__________________________________________________    


        let atomicBatch = SYMBIOTE_META.STATE.batch()

        
        //Change state of accounts & contracts
        //Use caching(such primitive for the first time)
        if(SYMBIOTE_META.ACCOUNTS.size>=CONFIG.SYMBIOTE.BLOCK_TO_BLOCK_CACHE_SIZE){

            SYMBIOTE_META.ACCOUNTS.forEach((acc,addr)=>

                atomicBatch.put(addr,acc.ACCOUNT)

            )
            
            SYMBIOTE_META.ACCOUNTS.clear()//flush cache.NOTE-some kind of advanced upgrade soon
        
        }else{
            
            SYMBIOTE_META.ACCOUNTS.forEach((acc,addr)=>{

                atomicBatch.put(addr,acc.ACCOUNT)

                //Update urgent balance for the next blocks
                acc.OUT=acc.ACCOUNT.B

                //Clear sets of nonces(NOTE: Optional chaining here because some accounts are newly created)
                acc.NS?.clear()
                acc.ND?.clear()

            })
        
        }


        //Change finalization pointer
        SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.VALIDATOR=block.c

        SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.INDEX=block.i
                
        SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.HASH=blockHash

        
        //Change metadata per validator's thread
        SYMBIOTE_META.VERIFICATION_THREAD.VALIDATORS_METADATA[block.c].INDEX=block.i

        SYMBIOTE_META.VERIFICATION_THREAD.VALIDATORS_METADATA[block.c].HASH=blockHash


        //Finally - decrease the counter to snapshot
        SYMBIOTE_META.VERIFICATION_THREAD.SNAPSHOT_COUNTER--

        let snapCounter=SYMBIOTE_META.VERIFICATION_THREAD.SNAPSHOT_COUNTER


        //Fix the state of VERIFICATION_THREAD
        atomicBatch.put('VT',SYMBIOTE_META.VERIFICATION_THREAD)

        await atomicBatch.write()


        //Also just clear and add some advanced logic later-it will be crucial important upgrade for process of phantom blocks
        SYMBIOTE_META.BLACKLIST.clear()
        

        //__________________________________________CREATE SNAPSHOT IF YOU NEED_________________________________________


        block.i!==0//no sense to snaphost if no blocks yet
        &&
        CONFIG.SYMBIOTE.SNAPSHOTS.ENABLE//probably you don't won't to make snapshot on this machine
        &&
        snapCounter===0//if it's time to make snapshot(e.g. next 200th block generated)
        &&
        await MAKE_SNAPSHOT()


    }

}