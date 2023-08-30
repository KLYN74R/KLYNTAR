import {CHECK_IF_ALL_ASP_PRESENT,VERIFY_AGGREGATED_FINALIZATION_PROOF} from '../verification.js'

import {BLS_VERIFY,BLS_SIGN_DATA,GET_MAJORITY,USE_TEMPORARY_DB} from '../utils.js'

import SYSTEM_SYNC_OPERATIONS_VERIFIERS from '../systemOperationsVerifiers.js'

import{BODY,SAFE_ADD,PARSE_JSON,BLAKE3} from '../../../KLY_Utils/utils.js'

import {VERIFY_AGGREGATED_EPOCH_FINALIZATION_PROOF} from '../life.js'

import bls from '../../../KLY_Utils/signatures/multisig/bls.js'

import Block from '../essences/block.js'




let BLS_PUBKEY_FOR_FILTER = global.CONFIG.SYMBIOTE.PRIME_POOL_PUBKEY || global.CONFIG.SYMBIOTE.PUB,




//__________________________________________________________BASIC FUNCTIONAL_____________________________________________________________________




/*

[Description]:
    Accept blocks and return commitment if subchain sequence completed
  
[Accept]:

    Blocks
  
    {
        creator:'7GPupbq1vtKUgaqVeHiDbEJcxS7sSjwPnbht4eRaDBAEJv8ZKHNCSu2Am3CuWnHjta',
        time:1666744452126,
        transactions:[
            tx1,
            tx2,
            tx3,
        ]
        index:1337,
        prevHash:'0123456701234567012345670123456701234567012345670123456701234567',
        sig:'jXO7fLynU9nvN6Hok8r9lVXdFmjF5eye09t+aQsu+C/wyTWtqwHhPwHq/Nl0AgXDDbqDfhVmeJRKV85oSEDrMjVJFWxXVIQbNBhA7AZjQNn7UmTI75WAYNeQiyv4+R4S'
    }


[Response]:

    SIG(blockID+hash+checkpointFullID) => jXO7fLynU9nvN6Hok8r9lVXdFmjF5eye09t+aQsu+C/wyTWtqwHhPwHq/Nl0AgXDDbqDfhVmeJRKV85oSEDrMjVJFWxXVIQbNBhA7AZjQNn7UmTI75WAYNeQiyv4+R4S

    <OR> nothing

*/
acceptBlocksAndReturnCommitment = response => {
    
    let total = 0
    
    let buffer = Buffer.alloc(0)
    
    let checkpoint = global.SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT

    let checkpointFullID = checkpoint.hash+"#"+checkpoint.id

    let tempObject = global.SYMBIOTE_META.TEMP.get(checkpointFullID)


    //Check if we should accept this block.NOTE-use this option only in case if you want to stop accept blocks or override this process via custom runtime scripts or external services
    if(!global.CONFIG.SYMBIOTE.ROUTE_TRIGGERS.MAIN.ACCEPT_BLOCK){
        
        !response.aborted && response.end(JSON.stringify({err:'Route is off'}))
        
        return
    
    }

    if(tempObject.SYNCHRONIZER.has('TIME_TO_NEW_EPOCH')){

        !response.aborted && response.end(JSON.stringify({err:'Checkpoint is not fresh'}))
        
        return

    }

    if(!checkpoint.completed || !tempObject){

        !response.aborted && response.end(JSON.stringify({err:'QT checkpoint is incomplete'}))

        return

    }

    
    response.writeHeader('Access-Control-Allow-Origin','*').onAborted(()=>response.aborted=true).onData(async(chunk,last)=>{

        if(total+chunk.byteLength <= global.CONFIG.MAX_PAYLOAD_SIZE){
        
            buffer = await SAFE_ADD(buffer,chunk,response)//build full data from chunks
    
            total+=chunk.byteLength
        
            if(last){
            
                let block = await PARSE_JSON(buffer)

                let poolIsAFK = tempObject.SKIP_HANDLERS.has(block.creator) || tempObject.SYNCHRONIZER.has('CREATE_SKIP_HANDLER:'+block.creator)
            

                if(poolIsAFK){

                    !response.aborted && response.end(JSON.stringify({err:'This pool is AFK'}))
        
                    return

                }

                let poolsMetadataOnQuorumThread = checkpoint.poolsMetadata

                let poolIsReal = poolsMetadataOnQuorumThread[block.creator]

                let primePoolPubKey, itIsReservePoolWhichIsAuthorityNow, itsPrimePool

                if(poolIsReal){

                    if(!poolsMetadataOnQuorumThread[block.creator].isReserve){

                        primePoolPubKey = block.creator

                        itsPrimePool = true

                    }

                    else if(typeof tempObject.REASSIGNMENTS.get(block.creator) === 'string'){

                        primePoolPubKey = tempObject.REASSIGNMENTS.get(block.creator)

                        itIsReservePoolWhichIsAuthorityNow = true

                    }

                }

                let thisAuthorityCanGenerateBlocksNow = poolIsReal && ( itIsReservePoolWhichIsAuthorityNow || itsPrimePool )

                if(!thisAuthorityCanGenerateBlocksNow){

                    !response.aborted && response.end(JSON.stringify({err:`This block creator can't generate blocks`}))
        
                    return

                }
                


                let hash = Block.genHash(block)

                let blockID = checkpoint.id+":"+block.creator+":"+block.index

                let myCommitment = await USE_TEMPORARY_DB('get',tempObject.DATABASE,blockID).catch(_=>false)

                
                if(myCommitment){

                    !response.aborted && response.end(JSON.stringify({commitment:myCommitment}))

                    return
                
                }

                
                if(typeof block.index==='number' && typeof block.prevHash==='string' && typeof block.sig==='string' && typeof block.extraData === 'object' && Array.isArray(block.transactions)){

                    // Make sure that it's a chain
                    let checkIfItsChain = block.index===0 || await global.SYMBIOTE_META.BLOCKS.get(checkpoint.id+":"+block.creator+":"+(block.index-1)).then(prevBlock=>{
    
                        let prevHash = Block.genHash(prevBlock)
    
                        return prevHash === block.prevHash
    
                    }).catch(_=>false)

                    // Verify block signature
                    let allChecksPassed = checkIfItsChain && await BLS_VERIFY(hash,block.sig,block.creator).catch(_=>false)                    

                    
                    // Also, if it's second block in epoch(index = 1,because numeration starts from 0) - make sure that we have aggregated commitments for the first block. We'll need it for ASP
                    if(block.index===1){

                        let proofIsOk = false

                        if(typeof block.extraData.aggregatedCommitmentsForFirstBlock === 'object'){


                            let rootPub = global.SYMBIOTE_META.STATIC_STUFF_CACHE.get('QT_ROOTPUB'+checkpointFullID)

                            let {blockID,blockHash,aggregatedPub,aggregatedSignature,afkVoters} = block.extraData.aggregatedCommitmentsForFirstBlock

                            let blockIDForFirstBlock = checkpoint.id+':'+block.creator+':'+0

                            let dataThatShouldBeSigned = blockIDForFirstBlock+blockHash+checkpointFullID // blockID_FOR_FIRST_BLOCK+hash+checkpointFullID
                
                            let majority = GET_MAJORITY(checkpoint)
                        
                            let reverseThreshold = checkpoint.length - majority
                

                            proofIsOk =  blockID === blockIDForFirstBlock && await bls.verifyThresholdSignature(
                                
                                aggregatedPub,afkVoters,rootPub,dataThatShouldBeSigned,aggregatedSignature,reverseThreshold
                                
                            ).catch(_=>false)


                            if(proofIsOk){

                                // Store locally

                                await USE_TEMPORARY_DB('put',tempObject.DATABASE,'AC_FOR_FIRST_BLOCK:'+block.creator,{blockID,blockHash,aggregatedPub,aggregatedSignature,afkVoters}).catch(_=>false)

                            }
    
                        }

                        if(!proofIsOk){

                            !response.aborted && response.end(JSON.stringify({err:'No proof for the first block'}))

                            return

                        }

                    }


                    /*
                    
                        And finally, if it's the first block in epoch - verify that it contains:
                        
                        1) AGGREGATED_EPOCH_FINALIZATION_PROOF for previous epoch(in case we're not working on epoch 0) in block.extraData.previousAggregatedEpochFinalizationProof
                        2) All the ASPs for previous pools in reassignment chains in section block.extraData.reassignments(in case the block creator is not a prime pool)

                        Also, these proofs should be only in the first block in epoch, so no sense to verify blocks with index !=0


                    */

                    //_________________________________________1_________________________________________

                    allChecksPassed &&= block.index!==0 || await VERIFY_AGGREGATED_EPOCH_FINALIZATION_PROOF(
                        
                        block.extraData.previousAggregatedEpochFinalizationProof,
                        
                        checkpoint.quorum,
                        
                        GET_MAJORITY(checkpoint),
                        
                        global.SYMBIOTE_META.STATIC_STUFF_CACHE.get('QT_ROOTPUB'+checkpointFullID),

                        checkpointFullID
                        
                    )

                    //_________________________________________2_________________________________________

                    let reassignmentArray = checkpoint.reassignmentChains[primePoolPubKey]

                    let positionOfBlockCreatorInReassignmentChain = reassignmentArray.indexOf(block.creator)

                    allChecksPassed &&= block.index!==0 || itsPrimePool || await CHECK_IF_ALL_ASP_PRESENT(
                        
                        primePoolPubKey,
                        
                        block,
                        
                        positionOfBlockCreatorInReassignmentChain,
                        
                        checkpointFullID,
                        
                        poolsMetadataOnQuorumThread,
                        
                        'QUORUM_THREAD'
                        
                    ).then(value=>value.isOK).catch(_=>false)
    



                    if(allChecksPassed){
                        
                        // Store it locally-we'll work with this block later
                        global.SYMBIOTE_META.BLOCKS.get(blockID).catch(
                                
                            _ =>
                                
                                global.SYMBIOTE_META.BLOCKS.put(blockID,block).catch(_=>{})
                             
                        )
                        
                        // Check the synchronizer to make sure if we're not voting for the same block
                        
                        if(!tempObject.SYNCHRONIZER.has('COM:'+blockID)){

                            // Add the synchronization moment to prevent double voting for two different blocks(with hashes H1, H2) on the same height
                            tempObject.SYNCHRONIZER.set('COM:'+blockID,true)

                            // Now we can safely generate commitment for block without problems with async stuff
                            let commitment = await BLS_SIGN_DATA(blockID+hash+checkpointFullID)
                    
    
                            // Put to local storage to prevent double voting
                            await USE_TEMPORARY_DB('put',tempObject.DATABASE,blockID,commitment).then(()=>{

                                // Now we can remove the sync lock
                                tempObject.SYNCHRONIZER.delete('COM:'+blockID)

                                !response.aborted && response.end(JSON.stringify({commitment}))

                            }).catch(error=>!response.aborted && response.end(JSON.stringify({err:`Something wrong => ${JSON.stringify(error)}`})))
    

                        } else !response.aborted && response.end(JSON.stringify({err:'Wait'}))
    
    
                    }else !response.aborted && response.end(JSON.stringify({err:'Overview failed. Make sure input data is ok'}))
    

                }else !response.aborted && response.end(JSON.stringify({err:'Overview failed. Make sure input data is ok'}))
            
            }
        
        }else !response.aborted && response.end(JSON.stringify({err:'Payload limit'}))
    
    })

},




//Format of body : <transaction>
//There is no <creator> field-we get it from tx
acceptTransactions=response=>response.writeHeader('Access-Control-Allow-Origin','*').onAborted(()=>response.aborted=true).onData(async bytes=>{

    let transaction = await BODY(bytes,global.CONFIG.MAX_PAYLOAD_SIZE)
    
    //Reject all txs if route is off and other guards methods

    /*
    
        ...and do such "lightweight" verification here to prevent db bloating
        Anyway we can bump with some short-term desynchronization while perform operations over block
        Verify and normalize object
        Fetch values about fees and MC from some decentralized sources
    
        The second operand tells us:if buffer is full-it makes whole logical expression FALSE
        Also check if we have normalizer for this type of event

    
    */

    if(typeof transaction?.creator!=='string' || typeof transaction.nonce!=='number' || typeof transaction.sig!=='string'){

        !response.aborted && response.end(JSON.stringify({err:'Event structure is wrong'}))

        return
    }

    if(!global.CONFIG.SYMBIOTE.ROUTE_TRIGGERS.MAIN.ACCEPT_TXS){
        
        !response.aborted && response.end(JSON.stringify({err:'Route is off'}))
        
        return
        
    }

    if(!global.SYMBIOTE_META.FILTERS[transaction.type]){

        !response.aborted && response.end(JSON.stringify({err:'No such filter. Make sure your <tx.type> is supported by current version of workflow runned on symbiote'}))
        
        return

    }

    
    if(global.SYMBIOTE_META.MEMPOOL.length<global.CONFIG.SYMBIOTE.TXS_MEMPOOL_SIZE){

        let filteredEvent=await global.SYMBIOTE_META.FILTERS[transaction.type](transaction,BLS_PUBKEY_FOR_FILTER)

        if(filteredEvent){

            !response.aborted && response.end(JSON.stringify({status:'OK'}))

            global.SYMBIOTE_META.MEMPOOL.push(filteredEvent)
                        
        }else !response.aborted && response.end(JSON.stringify({err:`Can't get filtered value of tx`}))

    }else !response.aborted && response.end(JSON.stringify({err:'Mempool is fullfilled'}))

}),




/*

[Description]:
    
    Accept aggregated commitments which proofs us that 2/3N+1 has the same block and generate FINALIZATION_PROOF => SIG(blockID+hash+'FINALIZATION'+checkpointFullID)

[Accept]:

Aggregated version of commitments. This is the proof that 2/3N+1 has received the blockX with hash H and created the commitment(SIG(blockID+hash+checkpointFullID))


    {
        
        blockID:"1369:7cBETvyWGSvnaVbc7ZhSfRPYXmsTzZzYmraKEgxQMng8UPEEexpvVSgTuo8iza73oP:1337",

        blockHash:"0123456701234567012345670123456701234567012345670123456701234567",
        
        aggregatedPub:"7cBETvyWGSvnaVbc7ZhSfRPYXmsTzZzYmraKEgxQMng8UPEEexpvVSgTuo8iza73oP",

        aggregatedSigna:"kffamjvjEg4CMP8VsxTSfC/Gs3T/MgV1xHSbP5YXJI5eCINasivnw07f/lHmWdJjC4qsSrdxr+J8cItbWgbbqNaM+3W4HROq2ojiAhsNw6yCmSBXl73Yhgb44vl5Q8qD",

        afkVoters:[...]

    }


___________________________Verification steps___________________________


[+] Verify the signa

[+] Make sure that at least 2/3N+1 is inside aggregated key/signa. Use afkVoters array for this and QUORUM_THREAD.QUORUM

[+] RootPub is equal to QUORUM_THREAD rootpub



[Response]:

    If everything is OK - response with signa SIG(blockID+hash+'FINALIZATION'+checkpointFullID)

    
*/
acceptAggregatedCommitmentsAndReturnFinalizationProof=response=>response.writeHeader('Access-Control-Allow-Origin','*').onAborted(()=>response.aborted=true).onData(async bytes=>{

    let aggregatedCommitments = await BODY(bytes,global.CONFIG.PAYLOAD_SIZE)

    let checkpoint = global.SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT

    if(global.CONFIG.SYMBIOTE.ROUTE_TRIGGERS.MAIN.SHARE_FINALIZATION_PROOF && checkpoint.completed){

        let checkpointFullID = checkpoint.hash+"#"+checkpoint.id

        if(!global.SYMBIOTE_META.TEMP.has(checkpointFullID)){

            !response.aborted && response.end(JSON.stringify({err:'QT checkpoint is incomplete'}))

            return
        }

        
        let tempObject = global.SYMBIOTE_META.TEMP.get(checkpointFullID)


        if(tempObject.SYNCHRONIZER.has('TIME_TO_NEW_EPOCH')){

            !response.aborted && response.end(JSON.stringify({err:'Checkpoint is not fresh'}))
    
        }else{

            
            let {blockID,blockHash,aggregatedPub,aggregatedSignature,afkVoters} = aggregatedCommitments

            if(typeof aggregatedPub !== 'string' || typeof aggregatedSignature !== 'string' || typeof blockID !== 'string' || typeof blockHash !== 'string' || !Array.isArray(afkVoters)){

                !response.aborted && response.end(JSON.stringify({err:'Wrong format of input params'}))

                return

            }

            let [_epochID,blockCreator,_blockIndexInEpoch] = blockID.split(':')

            let poolIsAFK = tempObject.SKIP_HANDLERS.has(blockCreator) || tempObject.SYNCHRONIZER.has('CREATE_SKIP_HANDLER:'+blockCreator)
            

            if(poolIsAFK){

                !response.aborted && response.end(JSON.stringify({err:'This pool is AFK'}))
        
                return

            }


            let rootPub = global.SYMBIOTE_META.STATIC_STUFF_CACHE.get('QT_ROOTPUB'+checkpointFullID)

            let dataThatShouldBeSigned = blockID+blockHash+checkpointFullID

            let majority = GET_MAJORITY(checkpoint)
        
            let reverseThreshold = checkpoint.length - majority

            let aggregatedCommitmentsIsOk = await bls.verifyThresholdSignature(
                
                aggregatedPub,afkVoters,rootPub,dataThatShouldBeSigned,aggregatedSignature,reverseThreshold
                
            ).catch(_=>false)

            let primePoolOrAtLeastReassignment = checkpoint.poolsMetadata[blockCreator] && (tempObject.REASSIGNMENTS.has(blockCreator) && checkpoint.poolsMetadata[blockCreator].isReserve || !checkpoint.poolsMetadata[blockCreator].isReserve)
                        

            if(aggregatedCommitmentsIsOk && primePoolOrAtLeastReassignment){

                let poolIsAFK2 = tempObject.SKIP_HANDLERS.has(blockCreator) || tempObject.SYNCHRONIZER.has('CREATE_SKIP_HANDLER:'+blockCreator)

                if(!tempObject.SYNCHRONIZER.has('FP:'+blockID) && !poolIsAFK2){

                    // Sync flag
                    tempObject.SYNCHRONIZER.set('FP:'+blockID,true)

                    // Add the flag for function SUBCHAINS_HEALTH_MONITORING where we need to create skip handler to avoid async problems
                    tempObject.SYNCHRONIZER.set('NO_FP_NOW:'+blockCreator,false)


                    let [_epochID,poolPubKey,index] = blockID.split(':')

                    index=+index
                
                    let fpSignature = await BLS_SIGN_DATA(blockID+blockHash+'FINALIZATION'+checkpointFullID)

                    // If it's commitments for the first block in epoch - store it locally
                    if(index === 0){

                        let storeStatusIsOk = await USE_TEMPORARY_DB('put',tempObject.DATABASE,'AC_FOR_FIRST_BLOCK:'+poolPubKey,{blockID,blockHash,aggregatedPub,aggregatedSignature,afkVoters}).then(()=>true).catch(_=>false)

                        if(!storeStatusIsOk){

                            !response.aborted && response.end(JSON.stringify({err:`Can't store the AC for first block in epoch`}))

                            return

                        }

                    }
                    

                    // Now, try to update the checkpoint manager

                    let currentDataInCheckpointManager = tempObject.CHECKPOINT_MANAGER.get(poolPubKey) || {index:-1,hash:'0123456701234567012345670123456701234567012345670123456701234567'}

                    if(currentDataInCheckpointManager.index < index){

                        // Update the local checkpoint manager

                        let updatedHandler = {
                            
                            index,
                            
                            hash:blockHash,

                            aggregatedCommitments:{aggregatedPub,aggregatedSignature,afkVoters}
                        
                        }

                        // Now push to persistent DB first

                        await USE_TEMPORARY_DB('put',tempObject.DATABASE,poolPubKey,updatedHandler).then(()=>{

                            // And only after db - update the finalization height for CHECKPOINT_MANAGER
                            tempObject.CHECKPOINT_MANAGER.set(poolPubKey,updatedHandler)

                            // Delete from sync mode
                            tempObject.SYNCHRONIZER.delete('FP:'+blockID)

                            // Make it possible to create skip handler in function SUBCHAINS_HEALTH_MONITORING
                            tempObject.SYNCHRONIZER.set('NO_FP_NOW:'+blockCreator,true)

                            // And finally - send response
                            !response.aborted && response.end(JSON.stringify({fp:fpSignature}))


                        }).catch(_=>!response.aborted && response.end(JSON.stringify({err:'Wait'})))


                    }else{

                        // Delete from sync mode
                        tempObject.SYNCHRONIZER.delete('FP:'+blockID)

                        // Make it possible to create skip handler in function SUBCHAINS_HEALTH_MONITORING
                        tempObject.SYNCHRONIZER.set('NO_FP_NOW:'+blockCreator,true)

                        // And finally - send response
                        !response.aborted && response.end(JSON.stringify({fp:fpSignature}))

                    }

                }else !response.aborted && response.end(JSON.stringify({err:'Wait'}))
                
            }else !response.aborted && response.end(JSON.stringify({err:`Something wrong because all of 2 must be true => aggregatedCommitmentsIsOk:${aggregatedCommitmentsIsOk} | primePoolOrAtLeastReassignment:${primePoolOrAtLeastReassignment}`}))

        }

    }else !response.aborted && response.end(JSON.stringify({err:'Route is off or QT checkpoint is incomplete'}))

}),




/*

*********************************************************************
                                                                    *
Accept AGGREGATED_FINALIZATION_PROOF or send if it exists locally   *
                                                                    *
*********************************************************************


*/
acceptAggregatedFinalizationProof=response=>response.writeHeader('Access-Control-Allow-Origin','*').onAborted(()=>response.aborted=true).onData(async bytes=>{

    let checkpoint = global.SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT

    let checkpointFullID = checkpoint.hash+"#"+checkpoint.id

    let tempObject = global.SYMBIOTE_META.TEMP.get(checkpointFullID)


    if(!tempObject){

        !response.aborted && response.end(JSON.stringify({err:'Checkpoint is not fresh'}))

        return
    }

    
   
    let possibleAggregatedFinalizationProof = await BODY(bytes,global.CONFIG.MAX_PAYLOAD_SIZE)

    let {blockID,blockHash,aggregatedPub,aggregatedSignature,afkVoters} = possibleAggregatedFinalizationProof
    
    if(typeof aggregatedPub !== 'string' || typeof aggregatedSignature !== 'string' || typeof blockID !== 'string' || typeof blockHash !== 'string' || !Array.isArray(afkVoters)){

        !response.aborted && response.end(JSON.stringify({err:'Wrong format of input params'}))

        return

    }

    let myLocalBlock = await global.SYMBIOTE_META.BLOCKS.get(blockID).catch(_=>false)

    let [_epochIndex,blockCreator,_] = blockID.split(':')


    let hashesAreEqual = myLocalBlock ? Block.genHash(myLocalBlock) === blockHash : false

    let quorumSignaIsOk = await VERIFY_AGGREGATED_FINALIZATION_PROOF(possibleAggregatedFinalizationProof,checkpoint,global.SYMBIOTE_META.STATIC_STUFF_CACHE.get('QT_ROOTPUB'+checkpointFullID))
    
    let primePoolOrAtLeastReassignment = checkpoint.poolsMetadata[blockCreator] && (tempObject.REASSIGNMENTS.has(blockCreator) && checkpoint.poolsMetadata[blockCreator].isReserve || !checkpoint.poolsMetadata[blockCreator].isReserve)


    if(quorumSignaIsOk && hashesAreEqual && primePoolOrAtLeastReassignment){

        await global.SYMBIOTE_META.EPOCH_DATA.put('AFP:'+blockID,{blockID,blockHash,aggregatedPub,aggregatedSignature,afkVoters}).catch(_=>{})

        !response.aborted && response.end(JSON.stringify({status:'OK'}))

    }else !response.aborted && response.end(JSON.stringify({err:`Something wrong because all of 3 must be true => signa_is_ok:${quorumSignaIsOk} | hashesAreEqual:${hashesAreEqual} | primePoolOrAtLeastReassignment:${primePoolOrAtLeastReassignment}`}))


}),




/*

To return AGGREGATED_FINALIZATION_PROOF related to some block PubX:Index

Only in case when we have AGGREGATED_FINALIZATION_PROOF we can verify block with the 100% garantee that it's the part of valid subchain and will be included to checkpoint 

Params:

    [0] - blockID in format EpochID:BlockCreatorBLSPubKey:IndexOfBlockInEpoch. Example 733:75XPnpDxrAtyjcwXaATfDhkYTGBoHuonDU1tfqFc6JcNPf5sgtcsvBRXaXZGuJ8USG:99

Returns:

    {
        blockID,
        blockHash,
        aggregatedSignature:<>, // blockID+hash+'FINALIZATION'+QT.CHECKPOINT.HASH+"#"+QT.CHECKPOINT.id
        aggregatedPub:<>,
        afkVoters
        
    }

*/
getAggregatedFinalizationProof=async(response,request)=>{

    response.onAborted(()=>response.aborted=true).writeHeader('Access-Control-Allow-Origin','*')


    if(global.CONFIG.SYMBIOTE.ROUTE_TRIGGERS.MAIN.GET_AGGREGATED_FINALIZATION_PROOFS){

        let checkpointFullID = global.SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT.hash+"#"+global.SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT.id

        if(!global.SYMBIOTE_META.TEMP.has(checkpointFullID)){

            !response.aborted && response.end(JSON.stringify({err:'QT checkpoint is not ready'}))

            return
        }

        let blockID = request.getParameter(0)
       
        let aggregatedFinalizationProof = await global.SYMBIOTE_META.EPOCH_DATA.get('AFP:'+blockID).catch(_=>false)


        if(aggregatedFinalizationProof){

            !response.aborted && response.end(JSON.stringify(aggregatedFinalizationProof))

        }else !response.aborted && response.end(JSON.stringify({err:'No proof'}))

    }else !response.aborted && response.end(JSON.stringify({err:'Route is off'}))

},




/*

To return AFP(AGGREGATED_FINALIZATION_PROOF) related to the latest block we have 

Only in case when we have AFP we can verify block with the 100% garantee that it's the part of valid subchain and will be included to checkpoint 

Params:

Returns:

    {

        afpForFirstBlock:{

            blockID,
            
            blockHash,

            aggregatedPub:bls.aggregatePublicKeys(signers),
            
            aggregatedSignature:bls.aggregateSignatures(signatures),
            
            afkVoters

        },


        currentHealth:{

            index, // height of block that we already finalized. Also, below you can see the AGGREGATED_FINALIZATION_PROOF. We need it as a quick proof that majority have voted for this segment of subchain
        
            hash:<>,

            aggregatedFinalizationProof:{
            
                aggregatedSignature:<>, // blockID+hash+'FINALIZATION'+QT.CHECKPOINT.HASH+"#"+QT.CHECKPOINT.id
                aggregatedPub:<>,
                afkVoters
        
            }

        }
            
    
    }

*/
healthChecker = async response => {

    response.onAborted(()=>response.aborted=true)

    if(global.CONFIG.SYMBIOTE.ROUTE_TRIGGERS.MAIN.HEALTH_CHECKER){

        // Get the latest AGGREGATED_FINALIZATION_PROOF that we have

        let currentHealth = global.SYMBIOTE_META.STATIC_STUFF_CACHE.get('HEALTH')

        // Now, try to get the AFP for the first block in epoch

        let afpForFirstBlock = global.SYMBIOTE_META.STATIC_STUFF_CACHE.get('AFP_FOR_MY_FIRST_BLOCK_IN_EPOCH')

        if(!afpForFirstBlock){

            // Find the AFP proof for the first block in current epoch
            let firstBlockInEpochID = `${global.SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT.id}:${global.CONFIG.SYMBIOTE.PUB}:0`

            let afpForMyBlock = await global.SYMBIOTE_META.EPOCH_DATA.get('AFP:'+firstBlockInEpochID).catch(_=>false)

            // Add to cache
            global.SYMBIOTE_META.STATIC_STUFF_CACHE.set('AFP_FOR_MY_FIRST_BLOCK_IN_EPOCH',afpForMyBlock)

        }


        if(currentHealth && afpForFirstBlock){

            let healthProof = {afpForFirstBlock,currentHealth}

            !response.aborted && response.end(JSON.stringify(healthProof))

        }else !response.aborted && response.end(JSON.stringify({err:`Still haven't start the procedure of grabbing finalization proofs`}))


    }else !response.aborted && response.end(JSON.stringify({err:'Route is off'}))

},




/*

To return the stats about the health about another pool

[Params]:

    0 - poolID

[Returns]:

    Our local stats about the health of provided pool


    {

        afpForFirstBlock:{

            blockID,
            
            blockHash,

            aggregatedPub:bls.aggregatePublicKeys(signers),
            
            aggregatedSignature:bls.aggregateSignatures(signatures),
            
            afkVoters

        },


        currentHealth:{

            index, // height of block that we already finalized. Also, below you can see the AGGREGATED_FINALIZATION_PROOF. We need it as a quick proof that majority have voted for this segment of subchain
        
            hash:<>,

            aggregatedFinalizationProof:{

                aggregatedPub,
                aggregatedSignature:<>, // SIG(blockID+blockHash+'FINALIZATION'+checkpointFullID)
                afkVoters
        
            }

        }
    
    }


*/
anotherPoolHealthChecker = async(response,request) => {

    response.onAborted(()=>response.aborted=true)

    if(global.CONFIG.SYMBIOTE.ROUTE_TRIGGERS.MAIN.HEALTH_CHECKER){

        
        let requestedPoolPubKey = request.getParameter(0)

        let quorumThreadCheckpointFullID = global.SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT.hash+"#"+global.SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT.id

        let tempObject = global.SYMBIOTE_META.TEMP.get(quorumThreadCheckpointFullID)

    
        if(!tempObject){
    
            !response.aborted && response.end(JSON.stringify({err:'QT checkpoint is not ready'}))
    
            return
        }


        // Get the stats from our HEALTH_CHECKER

        let healthHandler = tempObject.HEALTH_MONITORING.get(requestedPoolPubKey)

        if(healthHandler){

            !response.aborted && response.end(JSON.stringify(healthHandler))

        }else !response.aborted && response.end(JSON.stringify({err:'No health handler'}))


    }else !response.aborted && response.end(JSON.stringify({err:'Route is off'}))

},



// Function to return signature of skip proof if we have SKIP_HANDLER for requested subchain. Return the signature if requested INDEX >= than our own or send UPDATE message with FINALIZATION_PROOF 

/*


[Accept]:

    {

        poolPubKey,

        firstBlockProofs:{

            blockID,    => epochID:poolPubKey:0
            blockHash,
            aggregatedPub,
            aggregatedSigna, // SIG(blockID+blockHash+QT.CHECKPOINT.HASH+"#"+QT.CHECKPOINT.id)
            afkVoters

        }

        extendedAggregatedCommitments:{
            
            index,
            
            hash,

            aggregatedCommitments:{

                aggregatedPub,
                aggregatedSignature:<>, // SIG(blockID+blockHash+QT.CHECKPOINT.HASH+"#"+QT.CHECKPOINT.id)
                afkVoters:[...]

            }

        }

    }


[Response]:


[1] In case we have skip handler for this pool in SKIP_HANDLERS and if <extendedAggregatedCommitments> in skip handler has <= index than in FP from request we can response:
        
        {
            type:'OK',
            sig: BLS_SIG('SKIP:<poolPubKey>:<firstBlockHash>:<index>:<hash>:<checkpointFullID>')
        }


[2] In case we have bigger index in <extendedAggregatedCommitments> - response with 'UPDATE' message:

    {
        type:'UPDATE',
                        
        <extendedAggregatedCommitments>:{
                            
            index,
            hash,
            aggregatedCommitments:{aggregatedPub,aggregatedSignature,afkVoters}
        
        }
                        
    }


    + check the aggregated commitments (AC) in section <firstBlockProofs>. Generate skip proofs only in case this one is valid


*/
getSkipProof=response=>response.writeHeader('Access-Control-Allow-Origin','*').onAborted(()=>response.aborted=true).onData(async bytes=>{

    let checkpoint = global.SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT

    let checkpointFullID = checkpoint.hash+"#"+checkpoint.id

    let tempObject = global.SYMBIOTE_META.TEMP.get(checkpointFullID)

    if(!tempObject){

        !response.aborted && response.end(JSON.stringify({err:'Checkpoint is not fresh'}))

        return
    }


    let mySkipHandlers = tempObject.SKIP_HANDLERS

    let majority = GET_MAJORITY(checkpoint)

    let reverseThreshold = checkpoint.quorum.length-majority

    let qtRootPub = global.SYMBIOTE_META.STATIC_STUFF_CACHE.get('QT_ROOTPUB'+checkpointFullID)

    
    let requestForSkipProof=await BODY(bytes,global.CONFIG.PAYLOAD_SIZE)


    if(typeof requestForSkipProof === 'object' && mySkipHandlers.has(requestForSkipProof.poolPubKey) && typeof requestForSkipProof.extendedAggregatedCommitments){

        
        
        let {index,hash,aggregatedCommitments} = requestForSkipProof.extendedAggregatedCommitments

        let localSkipHandler = mySkipHandlers.get(requestForSkipProof.poolPubKey)



        // We can't sign the skip proof in case requested height is lower than our local version of aggregated commitments. So, send 'UPDATE' message
        if(localSkipHandler.extendedAggregatedCommitments.index > index){

            let responseData = {
                
                type:'UPDATE',

                extendedAggregatedCommitments:localSkipHandler.extendedAggregatedCommitments

            }

            !response.aborted && response.end(JSON.stringify(responseData))


        }else if(typeof aggregatedCommitments === 'object'){

            // Otherwise we can generate skip proof(signature) and return. But, anyway - check the <aggregatedCommitments> in request

            let {aggregatedPub,aggregatedSignature,afkVoters} = aggregatedCommitments
            
            let dataThatShouldBeSigned = requestForSkipProof.poolPubKey+':'+index+hash+checkpointFullID
            
            let aggregatedCommitmentsIsOk = await bls.verifyThresholdSignature(aggregatedPub,afkVoters,qtRootPub,dataThatShouldBeSigned,aggregatedSignature,reverseThreshold).catch(_=>false)

            // If signature is ok - generate skip proof

            if(aggregatedCommitmentsIsOk){

                let skipMessage = {
                    
                    type:'OK',

                    sig:await BLS_SIGN_DATA(`SKIP:${requestForSkipProof.poolPubKey}:${index}:${hash}:${checkpointFullID}`)
                }

                !response.aborted && response.end(JSON.stringify(skipMessage))

                
            }else !response.aborted && response.end(JSON.stringify({err:'Wrong signature'}))

             
        }else !response.aborted && response.end(JSON.stringify({err:'Wrong format'}))


    }else !response.aborted && response.end(JSON.stringify({err:'Wrong format'}))


}),



/*

[Info]: Once quorum member who already have ASP get the 2/3N+1 approvements for reassignment it can produce commitments, finalization proofs for the next reserve pool in (QT/VT).CHECKPOINT.REASSIGNMENT_CHAINS[<primePool>] and start to monitor health for this pool

[Accept]:

{
    poolPubKey:<pool BLS public key>,
    session:<32-bytes hex string>
}


[Response]:

If we also have an <aggregatedSkipProof> in our local SKIP_HANDLERS[<poolPubKey>] - we can vote for reassignment:

Response => {type:'OK',sig:SIG(`REASSIGNMENT:<poolPubKey>:<session>:<checkpointFullID>`)}

Otherwise => {type:'ERR'}

*/
getReassignmentReadyStatus=response=>response.writeHeader('Access-Control-Allow-Origin','*').onAborted(()=>response.aborted=true).onData(async bytes=>{

    let checkpointFullID = global.SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT.hash+"#"+global.SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT.id

    let tempObject = global.SYMBIOTE_META.TEMP.get(checkpointFullID)

    if(!tempObject){

        !response.aborted && response.end(JSON.stringify({err:'Checkpoint is not fresh'}))

        return
    }

    
    let reassignmentApprovementRequest = await BODY(bytes,global.CONFIG.PAYLOAD_SIZE)

    let skipHandler = tempObject.SKIP_HANDLERS.get(reassignmentApprovementRequest?.poolPubKey)


    if(skipHandler && skipHandler.aggregatedSkipProof && typeof reassignmentApprovementRequest.session === 'string' && reassignmentApprovementRequest.session.length === 64){

        let signatureToResponse = await BLS_SIGN_DATA(`REASSIGNMENT:${reassignmentApprovementRequest.poolPubKey}:${reassignmentApprovementRequest.session}:${checkpointFullID}`)

        !response.aborted && response.end(JSON.stringify({type:'OK',sig:signatureToResponse}))

    }else !response.aborted && response.end(JSON.stringify({type:'ERR'}))


}),



/*


[Info]:

    Route to ask for <aggregatedSkipProof>(s) in function TEMPORARY_REASSIGNMENTS_BUILDER()


[Accept]:

    Nothing


[Returns]:

Object like {

    primePool => {currentAuthorityIndex,firstBlockByCurrentAuthority,afpForFirstBlockByCurrentAuthority}

}

___________________________________________________________

[0] currentAuthorityIndex - index of current authority for subchain X. To get the pubkey of subchain authority - take the QUORUM_THREAD.CHECKPOINT.REASSIGNMENT_CHAINS[<primePool>][currentAuthorityIndex]

[1] firstBlockByCurrentAuthority - default block structure

[2] afpForFirstBlockByCurrentAuthority - default SFP structure -> 


    {
        
        blockID,
        blockHash,
        aggregatedSignature:<>, // blockID+hash+'FINALIZATION'+QT.CHECKPOINT.HASH+"#"+QT.CHECKPOINT.id
        aggregatedPub:<>,
        afkVoters
        
    }


*/
getDataForTempReassignments = async response => {

    response.onAborted(()=>response.aborted=true)

    if(global.CONFIG.SYMBIOTE.ROUTE_TRIGGERS.MAIN.GET_DATA_FOR_TEMP_REASSIGN){

        let checkpoint = global.SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT

        let quorumThreadCheckpointFullID = checkpoint.hash+"#"+checkpoint.id

        let quorumThreadCheckpointIndex = checkpoint.id

        let tempObject = global.SYMBIOTE_META.TEMP.get(quorumThreadCheckpointFullID)

        if(!tempObject){
    
            !response.aborted && response.end(JSON.stringify({err:'QT checkpoint is not ready'}))
    
            return
        }

        // Get the current authorities for subchains from REASSIGNMENTS

        let currentPrimePools = Object.keys(checkpoint.reassignmentChains) // [primePool0, primePool1, ...]

        let templateForResponse = {} // primePool => {currentAuthorityIndex,firstBlockByCurrentAuthority,afpForFirstBlockByCurrentAuthority}

        for(let primePool of currentPrimePools){

            // Get the current authority

            let reassignmentHandler = tempObject.REASSIGNMENTS.get(primePool) // primePool => {currentAuthority:<number>}

            if(reassignmentHandler){

                let currentAuthorityIndex = reassignmentHandler.currentAuthority

                let currentSubchainAuthority = currentAuthorityIndex === -1 ? primePool : checkpoint.reassignmentChains[primePool][currentAuthorityIndex]

                // Now get the first block & SFP for it

                let indexOfLatestBlockInPreviousEpoch = checkpoint.poolsMetadata[currentSubchainAuthority]?.index

                if(typeof indexOfLatestBlockInPreviousEpoch === 'number'){

                    let blockID = quorumThreadCheckpointIndex+":"+currentSubchainAuthority+":"+(indexOfLatestBlockInPreviousEpoch+1)

                    let firstBlockByCurrentAuthority = await global.SYMBIOTE_META.BLOCKS.get(blockID).catch(_=>false)

                    if(firstBlockByCurrentAuthority){

                        // Finally, find the SFP for this block

                        let afpForFirstBlockByCurrentAuthority = await global.SYMBIOTE_META.EPOCH_DATA.get('AFP:'+blockID).catch(_=>false)

                        // Put to response

                        templateForResponse[primePool]={

                            currentAuthorityIndex,
                            
                            firstBlockByCurrentAuthority,
                            
                            afpForFirstBlockByCurrentAuthority
                            
                        }

                    }

                }

            }

        }

        // Finally, send the <templateForResponse> back

        !response.aborted && response.end(JSON.stringify(templateForResponse))


    }else !response.aborted && response.end(JSON.stringify({err:'Route is off'}))

},




/*
            
    The structure of AGGREGATED_EPOCH_FINALIZATION_PROOF is

    {
        lastAuthority:<index of BLS pubkey of some pool in subchain's reassignment chain>,
        lastIndex:<index of his block in previous epoch>,
        lastHash:<hash of this block>,

        proof:{

                aggregatedPub:<BLS aggregated pubkey of signers>,
                aggregatedSignature: SIG('EPOCH_DONE'+lastAuth+lastIndex+lastHash+checkpointFullId)
                afkVoters:[] - array of BLS pubkeys who haven't voted

        }
    
    }

*/
getAggregatedEpochFinalizationProof=async(response,request)=>{

    response.onAborted(()=>response.aborted=true)

    if(global.CONFIG.SYMBIOTE.ROUTE_TRIGGERS.MAIN.GET_AGGREGATED_EPOCH_FINALIZATION_PROOF){

        let checkpointFullID = global.SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT.hash+"#"+global.SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT.id

        if(!global.SYMBIOTE_META.TEMP.has(checkpointFullID)){

            !response.aborted && response.end('QT checkpoint is not ready')
        
            return

        }


        let epochIndex = request.getParameter(0)

        let subchainID = request.getParameter(1)

        let aggregatedEpochFinalizationProofForSubchain = await global.SYMBIOTE_META.EPOCH_DATA.get(`AEFP:${epochIndex}:${subchainID}`).catch(_=>false)


        if(aggregatedEpochFinalizationProofForSubchain){

            !response.aborted && response.end(JSON.stringify(aggregatedEpochFinalizationProofForSubchain))

        }else !response.aborted && response.end(JSON.stringify({err:'No EFP'}))

    }else !response.aborted && response.end(JSON.stringify({err:'Route is off'}))

},




VERIFY_AGGREGATED_COMMITMENTS_AND_CHANGE_LOCAL_DATA = async(proposition,checkpoint,pubKeyOfCurrentAuthorityOnSubchain,reassignmentForThisSubchain,tempObject,subchainID,checkpointManagerForAuthority,responseStructure) => {

    let checkpointFullID = checkpoint.hash+'#'+checkpoint.id

    let {index,hash,aggregatedCommitments} = proposition.finalizationProof

    let {aggregatedPub,aggregatedSignature,afkVoters} = aggregatedCommitments

    let rootPub = global.SYMBIOTE_META.STATIC_STUFF_CACHE.get('QT_ROOTPUB'+checkpointFullID)

    let dataThatShouldBeSigned = `${checkpoint.id}:${pubKeyOfCurrentAuthorityOnSubchain}:${index}`+hash+checkpointFullID // typical commitment signature blockID+hash+checkpointFullID

    let majority = GET_MAJORITY(checkpoint)

    let reverseThreshold = checkpoint.quorum.length-majority

    let isOk = await bls.verifyThresholdSignature(aggregatedPub,afkVoters,rootPub,dataThatShouldBeSigned,aggregatedSignature,reverseThreshold).catch(_=>false)


    if(isOk){

        if(reassignmentForThisSubchain) reassignmentForThisSubchain.currentAuthority = proposition.currentAuthority

        else tempObject.REASSIGNMENTS.set(subchainID,{currentAuthority:proposition.currentAuthority})


        if(checkpointManagerForAuthority){

            checkpointManagerForAuthority.index = index

            checkpointManagerForAuthority.hash = hash

            checkpointManagerForAuthority.aggregatedCommitments = aggregatedCommitments

        }else tempObject.CHECKPOINT_MANAGER.set(pubKeyOfCurrentAuthorityOnSubchain,{index,hash,aggregatedCommitments})

        // Generate EPOCH_FINALIZATION_PROOF_SIGNATURE

        let dataToSign = 'EPOCH_DONE'+proposition.currentAuthority+index+hash+checkpointFullID

        responseStructure[subchainID] = {
                            
            status:'OK',
                        
            sig:await BLS_SIGN_DATA(dataToSign)
                        
        }

    }

},




acceptCheckpointProposition=response=>response.writeHeader('Access-Control-Allow-Origin','*').onAborted(()=>response.aborted=true).onData(async bytes=>{

    let qtCheckpoint = global.SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT

    let checkpointFullID = qtCheckpoint.hash+"#"+qtCheckpoint.id

    let tempObject = global.SYMBIOTE_META.TEMP.get(checkpointFullID)


    if(!tempObject){

        !response.aborted && response.end(JSON.stringify({err:'Checkpoint is not fresh'}))

        return
    }

    if(!tempObject.SYNCHRONIZER.has('READY_FOR_CHECKPOINT')){

        !response.aborted && response.end(JSON.stringify({err:'This checkpoint is fresh or not ready for checkpoint'}))

        return

    }
    


    /* 
    
        Parse the checkpoint proposition

        !Reminder:  The structure of checkpoint proposition is(see life.js/CHECK_IF_ITS_TIME_TO_PROPOSE_CHECKPOINT function):

        {
                
            "subchain0":{

                currentAuth:<int - pointer to current authority of subchain based on QT.CHECKPOINT.reassignmentChains[primePool]. In case -1 - it's prime pool>

                finalizationProof:{
                    index:,
                    hash:,
                    aggregatedCommitments:{

                        aggregatedPub:,
                        aggregatedSignature:,
                        afkVoters:[],

                    }
                    
                }

            },

            "subchain1":{
                ...            
            }

            ...
                    
            "subchainN":{
                ...
            }
                
        }


        1) We need to iterate over propositions(per subchain)
        2) Compare <currentAuth> with our local version of current authority on subchain(take it from tempObj.REASSIGNMENTS)
        
            [If proposed.currentAuth >= local.currentAuth]:

                1) Verify index & hash & aggregated commitments in <finalizationProof>
                
                2) If proposed height >= local version - generate and return signature SIG('EPOCH_DONE'+lastAuth+lastIndex+lastHash+checkpointFullId)

                3) Else - send status:'UPGRADE' with local version of finalization proof, index and hash

            [Else if proposed.currentAuth < local.currentAuth AND tempObj.CHECKPOINT_MANAGER.has(local.currentAuth)]:

                1) Send status:'UPGRADE' with local version of currentAuthority, finalization proof, index and hash



        !Reminder: Response structure is

        {
            
            subchainA:{
                                
                status:'UPGRADE'|'OK',

                -------------------------------[In case 'OK']-------------------------------

                signa: SIG('EPOCH_DONE'+lastAuth+lastIndex+lastHash+checkpointFullId)
                        
                -----------------------------[In case 'UPGRADE']----------------------------

                currentAuthority:<index>,
                finalizationProof:{
                    index,hash,agregatedCommitments:{aggregatedPub,aggregatedSignature,afkVoters}
                }   

            },

            subchainB:{
                ...(same)
            },
            ...,
            subchainQ:{
                ...(same)
            }
    
        }


    */
   
    
    let possibleCheckpointProposition = await BODY(bytes,global.CONFIG.MAX_PAYLOAD_SIZE)

    let responseStructure = {}


    if(typeof possibleCheckpointProposition === 'object'){

        for(let [subchainID,proposition] of Object.entries(possibleCheckpointProposition)){


            if(responseStructure[subchainID]) continue


            if(typeof subchainID === 'string' && typeof proposition.currentAuthority === 'number' && typeof proposition.finalizationProof === 'object' && typeof proposition.finalizationProof.aggregatedCommitments === 'object'){

                // Get the local version of REASSIGNMENTS and CHECKPOINT_MANAGER

                let reassignmentForThisSubchain = tempObject.REASSIGNMENTS.get(subchainID) // {currentAuthority:<uint>}

                let pubKeyOfCurrentAuthorityOnSubchain, localIndexOfAuthority
                

                if(typeof reassignmentForThisSubchain === 'string') continue // type string is only for reserve pool. So, if this branch is true it's a sign that subchainID is pubkey of reserve pool what is impossible. So, continue

                else if(typeof reassignmentForThisSubchain === 'object') {

                    localIndexOfAuthority = reassignmentForThisSubchain.currentAuthority

                    pubKeyOfCurrentAuthorityOnSubchain = qtCheckpoint.reassignmentChains[subchainID][localIndexOfAuthority]

                }else{

                    // Assume that there is no data about reassignments for given subchain locally. So, imagine that epoch will stop on prime pool (prime pool pubkey === subchainID)

                    localIndexOfAuthority = -1

                    pubKeyOfCurrentAuthorityOnSubchain = subchainID

                }


                // Structure is {index,hash,aggregatedCommitments:{aggregatedPub,aggregatedSignature,afkVoters}}

                let checkpointManagerForAuthority = tempObject.CHECKPOINT_MANAGER.get(pubKeyOfCurrentAuthorityOnSubchain) || {index:-1,hash:'0123456701234567012345670123456701234567012345670123456701234567'}



                //_________________________________________ Now compare _________________________________________

                if(proposition.currentAuthority === localIndexOfAuthority){

                    if(checkpointManagerForAuthority.index === proposition.finalizationProof.index && checkpointManagerForAuthority.hash === proposition.finalizationProof.hash){

                        // Send EPOCH_FINALIZATION_PROOF signature

                        let {index,hash} = proposition.finalizationProof

                        let dataToSign = 'EPOCH_DONE'+proposition.currentAuthority+index+hash+checkpointFullID

                        responseStructure[subchainID] = {
                                            
                            status:'OK',
                                        
                            sig:await BLS_SIGN_DATA(dataToSign)
                                        
                        }

                    }else if(checkpointManagerForAuthority.index < proposition.finalizationProof.index){

                        // Verify AC & upgrade local version & send EPOCH_FINALIZATION_PROOF

                        await VERIFY_AGGREGATED_COMMITMENTS_AND_CHANGE_LOCAL_DATA(
                            
                            proposition,

                            qtCheckpoint,

                            pubKeyOfCurrentAuthorityOnSubchain,

                            reassignmentForThisSubchain,

                            tempObject,

                            subchainID,

                            checkpointManagerForAuthority,

                            responseStructure
                            
                        )

                    }else if(checkpointManagerForAuthority.index > proposition.finalizationProof.index){

                        // Send 'UPGRADE' msg

                        responseStructure[subchainID] = {

                            status:'UPGRADE',
                                
                            currentAuthority:localIndexOfAuthority,
                    
                            finalizationProof:checkpointManagerForAuthority
                        
                        }

                    }



                }else if(proposition.currentAuthority > localIndexOfAuthority){

                    // Verify aggregated commitments and if OK - update the local values in REASSIGNMENTS[subchainID] and CHECKPOINT_MANAGER[pubKeyOfCurrentAuthorityOnSubchain]

                    await VERIFY_AGGREGATED_COMMITMENTS_AND_CHANGE_LOCAL_DATA(
                            
                        proposition,

                        qtCheckpoint,

                        pubKeyOfCurrentAuthorityOnSubchain,

                        reassignmentForThisSubchain,

                        tempObject,

                        subchainID,

                        checkpointManagerForAuthority,

                        responseStructure
                        
                    )


                }else{

                    // Send 'UPGRADE' message

                    responseStructure[subchainID] = {

                        status:'UPGRADE',
                            
                        currentAuthority:localIndexOfAuthority,
                
                        finalizationProof:checkpointManagerForAuthority
                    
                    }

                }


            }            

        }


    }else !response.aborted && response.end(JSON.stringify({err:'Wrong format'}))


}),




getFirstBlockAssumptions=async(response,request)=>{

    response.onAborted(()=>response.aborted=true)

    if(global.CONFIG.SYMBIOTE.ROUTE_TRIGGERS.MAIN.GET_AGGREGATED_EPOCH_FINALIZATION_PROOF){

        let checkpointFullID = global.SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT.hash+"#"+global.SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT.id

        if(!global.SYMBIOTE_META.TEMP.has(checkpointFullID)){

            !response.aborted && response.end('QT checkpoint is not ready')
        
            return

        }


        let epochIndex = request.getParameter(0)

        let subchainID = request.getParameter(1)

        let aggregatedEpochFinalizationProofForSubchain = await global.SYMBIOTE_META.EPOCH_DATA.get(`AEFP:${epochIndex}:${subchainID}`).catch(_=>false)


        if(aggregatedEpochFinalizationProofForSubchain){

            !response.aborted && response.end(JSON.stringify(aggregatedEpochFinalizationProofForSubchain))

        }else !response.aborted && response.end(JSON.stringify({err:'No EFP'}))

    }else !response.aborted && response.end(JSON.stringify({err:'Route is off'}))

},




/*

Body is


{
    
    type:<operation id> ===> STAKING_CONTRACT_CALL | SLASH_UNSTAKE | UPDATE_RUBICON , etc. See ../systemOperationsVerifiers.js
    
    payload:{}

}

    * Payload has different structure depending on type


*/

systemSyncOperationsVerifier=response=>response.writeHeader('Access-Control-Allow-Origin','*').onAborted(()=>response.aborted=true).onData(async bytes=>{

    
    let systemSyncOperation = await BODY(bytes,global.CONFIG.MAX_PAYLOAD_SIZE)

    let checkpointFullID = global.SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT.hash+"#"+global.SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT.id


    if(!global.SYMBIOTE_META.TEMP.has(checkpointFullID) || !global.SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT.completed){

        !response.aborted && response.end(JSON.stringify({err:'QT checkpoint is not ready'}))

        return
    }


    if(!global.CONFIG.SYMBIOTE.ROUTE_TRIGGERS.MAIN.SYSTEM_SYNC_OPERATIONS){

        !response.aborted && response.end(JSON.stringify({err:`Route is off. This node don't accept system sync operations`}))

        return
    }

    //Verify and if OK - generate signature and return

    if(SYSTEM_SYNC_OPERATIONS_VERIFIERS[systemSyncOperation.type]){

        let possibleSystemSyncOperation = await SYSTEM_SYNC_OPERATIONS_VERIFIERS[systemSyncOperation.type](systemSyncOperation.payload,true,false).catch(error=>({isError:true,error})) // it's just verify without state changes

        if(possibleSystemSyncOperation?.isError){
            
            !response.aborted && response.end(JSON.stringify({err:`Verification failed. Reason => ${JSON.stringify(possibleSystemSyncOperation)}`}))

        }
        else if(possibleSystemSyncOperation){

            // Generate signature

            let signature = await BLS_SIGN_DATA(
                
                BLAKE3(JSON.stringify(possibleSystemSyncOperation)+checkpointFullID)
                
            )

            !response.aborted && response.end(JSON.stringify({

                signer:global.CONFIG.SYMBIOTE.PUB,
                
                signature

            }))
       
        }
        else !response.aborted && response.end(`Verification failed.Check your input data carefully. The returned object from function => ${JSON.stringify(possibleSystemSyncOperation)}`)

    }else !response.aborted && response.end(`No verification function for this system sync operation => ${systemSyncOperation.type}`)

}),




// To accept system sync operation, verify that majority from quorum agree with it and add to mempool

/*


    {
        aggreementProof:{

            aggregatedPub:<Base58 encoded BLS pubkey>,
            aggregatedSignature:BLS_SIGNATURE(
                
                BLAKE3( JSON(systemSyncOperation) + checkpointFullID)
                
            ),
            afkVoters:[]

        }

        systemSyncOperation:{<your operation here>}

    }




Returns object like:

    [If verification is OK and system sync operation was added to mempool]:

        {status:'OK'}

    [Else]:

        {err:''}



*/
systemSyncOperationToMempool=response=>response.writeHeader('Access-Control-Allow-Origin','*').onAborted(()=>response.aborted=true).onData(async bytes=>{


    let systemSyncOperationWithAgreementProof = await BODY(bytes,global.CONFIG.MAX_PAYLOAD_SIZE)

    let checkpoint = global.SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT

    let checkpointFullID = checkpoint.hash+"#"+checkpoint.id


    if(!global.SYMBIOTE_META.TEMP.has(checkpointFullID) || !checkpoint.completed){

        !response.aborted && response.end(JSON.stringify({err:'QT checkpoint is not ready'}))

        return
    }

    
    let tempObject = global.SYMBIOTE_META.TEMP.get(checkpointFullID)


    if(!global.CONFIG.SYMBIOTE.ROUTE_TRIGGERS.MAIN.SYSTEM_SYNC_OPERATIONS){

        !response.aborted && response.end(JSON.stringify({err:`Route is off. This node don't accept system sync operations`}))

        return
    }


    if(typeof systemSyncOperationWithAgreementProof.systemSyncOperation !== 'object' || typeof systemSyncOperationWithAgreementProof.aggreementProof !== 'object'){

        !response.aborted && response.end(JSON.stringify({err:`Wrong format. Input data must contain <systemSyncOperation>(your operation) and <agreementProof>(aggregated version of verification proofs from quorum members majority)`}))

        return

    }

    // Verify agreement and if OK - add to mempool

    let hashOfCheckpointFullIDAndOperation = BLAKE3(

        JSON.stringify(systemSyncOperationWithAgreementProof.systemSyncOperation) + checkpointFullID

    )

    let {aggregatedPub,aggregatedSignature,afkVoters} = systemSyncOperationWithAgreementProof.aggreementProof

    let reverseThreshold = checkpoint.quorum.length - GET_MAJORITY(checkpoint)

    let quorumSignaIsOk = await bls.verifyThresholdSignature(
        
        aggregatedPub,afkVoters,global.SYMBIOTE_META.STATIC_STUFF_CACHE.get('QT_ROOTPUB'+checkpointFullID),
        
        hashOfCheckpointFullIDAndOperation, aggregatedSignature, reverseThreshold
        
    )

    if(quorumSignaIsOk){

        // Add to mempool
        
        tempObject.SYSTEM_SYNC_OPERATIONS_MEMPOOL.push(systemSyncOperationWithAgreementProof.systemSyncOperation)

        !response.aborted && response.end(JSON.stringify({status:`OK`}))


    }else{

        !response.aborted && response.end(JSON.stringify({err:`Verification failed`}))

    }

}),




/*

To add node to local set of peers to exchange data with

Params:

    [symbioteID,hostToAdd(initiator's valid and resolved host)]

    [0] - symbiote ID       EXAMPLE: 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
    [1] - host to add       EXAMPLE: http://example.org | https://some.subdomain.org | http://cafe::babe:8888


Returns:

    'OK' - if node was added to local peers
    '<MSG>' - if some error occured

*/

addPeer=response=>response.writeHeader('Access-Control-Allow-Origin','*').onAborted(()=>response.aborted=true).onData(async bytes=>{
    
    let acceptedData = await BODY(bytes,global.CONFIG.PAYLOAD_SIZE)

    if(!Array.isArray(acceptedData)){

        !response.aborted && response.end('Input must be a 2-elements array like [symbioteID,you_endpoint]')
        
        return

    }

    let [symbioteID,domain]=acceptedData
   
    if(global.GENESIS.SYMBIOTE_ID!==symbioteID){

        !response.aborted && response.end('Symbiotic chain not supported')
        
        return

    }

    if(!global.CONFIG.SYMBIOTE.ROUTE_TRIGGERS.MAIN.NEW_NODES){

        !response.aborted && response.end('Route is off')
        
        return
    }
    
    if(typeof domain==='string' && domain.length<=256){
        
        //Add more advanced logic in future(or use plugins - it's even better)
        let nodes=global.SYMBIOTE_META.PEERS
        
        if(!(nodes.includes(domain) || global.CONFIG.SYMBIOTE.BOOTSTRAP_NODES.includes(domain))){
            
            nodes.length<global.CONFIG.SYMBIOTE.MAX_CONNECTIONS
            ?
            nodes.push(domain)
            :
            nodes[~~(Math.random() * nodes.length)]=domain//if no place-paste instead of random node
    
            !response.aborted && response.end('Your node has been added')
    
        }else !response.aborted && response.end('Your node already in scope')
    
    }else !response.aborted && response.end('Wrong types => endpoint(domain) must be 256 chars in length or less')

})








UWS_SERVER


//_______________________________ Consensus related routes _______________________________


//1st stage - accept block and response with the commitment
.post('/block',acceptBlocksAndReturnCommitment)

//2nd stage - accept aggregated commitments and response with the FINALIZATION_PROOF
.post('/finalization',acceptAggregatedCommitmentsAndReturnFinalizationProof)

//3rd stage - logic with super finalization proofs. Accept AGGREGATED_FINALIZATION_PROOF(aggregated 2/3N+1 FINALIZATION_PROOFs from QUORUM members)
.post('/aggregated_finalization_proof',acceptAggregatedFinalizationProof)

.get('/aggregated_finalization_proof/:BLOCK_ID',getAggregatedFinalizationProof)


//_______________________________ Routes for checkpoint _______________________________


.get('/aggregated_epoch_finalization_proof/:EPOCH_INDEX/:SUBCHAIN_ID',getAggregatedEpochFinalizationProof)

.post('/checkpoint_proposition',acceptCheckpointProposition)

.get('/first_block_assumptions',getFirstBlockAssumptions)


//________________________________ Health monitoring __________________________________


.get('/health',healthChecker)

.get('/get_health_of_another_pool/:POOL',anotherPoolHealthChecker)


//______________________ Routes related to the skip procedure _________________________


// Function to return signature of skip proof if we have SKIP_HANDLER for requested pool. Return the signature if requested INDEX >= than our own or send UPDATE message with AGGREGATED_COMMITMENTS 
.post('/get_skip_proof',getSkipProof)

// Function to accept ASP(aggregatedSkipProof) (2/3N+1 of signatures received from route /get_skip_proof). Once quorum member receve it - it can start ping quorum members to get 2/3N+1 approvements about reassignment
// .post('/accept_aggregated_skip_proof',acceptAggregatedSkipProof)

// Once quorum member who already have ASP get the 2/3N+1 approvements for reassignment it can produce commitments, finalization proofs for the next reserve pool in (QT/VT).CHECKPOINT.reassignmentChains[<primePool>] and start to monitor health for this pool
.post('/get_reassignment_ready_status',getReassignmentReadyStatus)


// We need this route for function TEMPORARY_REASSIGNMENTS_BUILDER() to build temporary reassignments. This function just return the ASP for some pools(if ASP exists locally)
.get('/get_data_for_temp_reassign',getDataForTempReassignments)


//___________________________________ Other ___________________________________________


.post('/sign_system_sync_operation',systemSyncOperationsVerifier)

.post('/system_sync_operation_to_mempool',systemSyncOperationToMempool)

.post('/transaction',acceptTransactions)

.post('/addpeer',addPeer)