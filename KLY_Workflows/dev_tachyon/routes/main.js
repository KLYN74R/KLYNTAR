import {CHECK_AGGREGATED_SKIP_PROOF_VALIDITY,CHECK_ASP_CHAIN_VALIDITY,GET_MANY_BLOCKS,VERIFY_AGGREGATED_FINALIZATION_PROOF} from '../verification.js'

import {BLS_VERIFY,BLS_SIGN_DATA,GET_MAJORITY,USE_TEMPORARY_DB} from '../utils.js'

import SYSTEM_SYNC_OPERATIONS_VERIFIERS from '../systemOperationsVerifiers.js'

import {VERIFY_AGGREGATED_EPOCH_FINALIZATION_PROOF} from '../life.js'

import bls from '../../../KLY_Utils/signatures/multisig/bls.js'

import{BODY,BLAKE3,LOG} from '../../../KLY_Utils/utils.js'

import Block from '../essences/block.js'

import WS from 'websocket'

import http from 'http'








let ACCEPT_BLOCKS_RANGE_AND_RETURN_COMMITMENT_FOR_LAST_BLOCK=async(parsedData,connection)=>{

        
    //_________________________________________________ Getting commitments _________________________________________________


        /*

            [Description]:

                Accept ranges of blocks and return commitment for the last block in range

            [Accept]:

                {
                
                    rangeOfBlocks:[
                    
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
                        
                        }, ...
                    
                    ],
                
                    previousRangeAfp:{
                    
                        blockID:"1369:7cBETvyWGSvnaVbc7ZhSfRPYXmsTzZzYmraKEgxQMng8UPEEexpvVSgTuo8iza73oP:1337",
                    
                        blockHash:"0123456701234567012345670123456701234567012345670123456701234567",
                    
                        aggregatedPub:"7cBETvyWGSvnaVbc7ZhSfRPYXmsTzZzYmraKEgxQMng8UPEEexpvVSgTuo8iza73oP",
                    
                        aggregatedSigna:"kffamjvjEg4CMP8VsxTSfC/Gs3T/MgV1xHSbP5YXJI5eCINasivnw07f/lHmWdJjC4qsSrdxr+J8cItbWgbbqNaM+3W4HROq2ojiAhsNw6yCmSBXl73Yhgb44vl5Q8qD",
                    
                        afkVoters:[...]
                    
                    }
                
                }
            
            
            
            [Response]:
            
                {
                    voter:<your BLS pubkey>,
                
                    commitment:SIG(blockID+hash+checkpointFullID) => jXO7fLynU9nvN6Hok8r9lVXdFmjF5eye09t+aQsu+C/wyTWtqwHhPwHq/Nl0AgXDDbqDfhVmeJRKV85oSEDrMjVJFWxXVIQbNBhA7AZjQNn7UmTI75WAYNeQiyv4+R4S
                }
            
                <OR>

                nothing

        */



    let checkpoint = global.SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT

    let checkpointFullID = checkpoint.hash+"#"+checkpoint.id

    let tempObject = global.SYMBIOTE_META.TEMP.get(checkpointFullID)

    //Check if we should accept this block.NOTE-use this option only in case if you want to stop accept blocks or override this process via custom runtime scripts or external services
        
    if(tempObject.SYNCHRONIZER.has('TIME_TO_NEW_EPOCH') || !tempObject){

        connection.close()
    
        return
    
    }

    let {rangeOfBlocks,previousRangeAfp} = parsedData

    if(!global.CONFIG.SYMBIOTE.ROUTE_TRIGGERS.MAIN.ACCEPT_BLOCK || typeof previousRangeAfp !== 'object' || !Array.isArray(rangeOfBlocks)){

        connection.close()

        return

    }

    let firstBlockInRange = rangeOfBlocks[0]

    let poolIsAFK = tempObject.SKIP_HANDLERS.has(firstBlockInRange.creator) || tempObject.SYNCHRONIZER.has('CREATE_SKIP_HANDLER:'+firstBlockInRange.creator)


    if(poolIsAFK){

        connection.close()

        return

    }


    let poolsRegistryOnQuorumThread = checkpoint.poolsRegistry

    let itsPrimePool = poolsRegistryOnQuorumThread.primePools.includes(firstBlockInRange.creator)

    let itsReservePool = poolsRegistryOnQuorumThread.reservePools.includes(firstBlockInRange.creator)

    let poolIsReal = itsPrimePool || itsReservePool

    let primePoolPubKey, itIsReservePoolWhichIsAuthorityNow

    if(poolIsReal){

        if(itsPrimePool) primePoolPubKey = firstBlockInRange.creator

        else if(typeof tempObject.REASSIGNMENTS.get(firstBlockInRange.creator) === 'string'){

            primePoolPubKey = tempObject.REASSIGNMENTS.get(firstBlockInRange.creator)

            itIsReservePoolWhichIsAuthorityNow = true

        }

    }

    let thisAuthorityCanGenerateBlocksNow = poolIsReal && ( itIsReservePoolWhichIsAuthorityNow || itsPrimePool )

    if(!thisAuthorityCanGenerateBlocksNow){

        connection.close()

        return

    }
    

    let lastBlockInRange = rangeOfBlocks[rangeOfBlocks.length - 1]

    // Try to check if we still haven't vote for this range

    let latestVotedHeightHandler = await USE_TEMPORARY_DB('get',tempObject.DATABASE,'LATEST_VOTED_HEIGHT:'+firstBlockInRange.creator).catch(()=>{

        return {latestHash:'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',latestIndex:-1}

    })

    // Make sure that we work in a sync mode + verify the signature for the latest block
    
    if(!tempObject.SYNCHRONIZER.has('COM:'+firstBlockInRange.creator)){

        let signaIsOk = await BLS_VERIFY(Block.genHash(lastBlockInRange),lastBlockInRange.sig,firstBlockInRange.creator).catch(()=>false)

        if(!signaIsOk) connection.close()

        // Add the flag for sync work
        
        if(tempObject.SYNCHRONIZER.has('COM:'+firstBlockInRange.creator)) return
        
        tempObject.SYNCHRONIZER.set('COM:'+firstBlockInRange.creator,true)

        // In case we haven't vote for previous range - check the AFP for previous one

        if(latestVotedHeightHandler.latestIndex+1 < firstBlockInRange.index){

            let previousRangeAfpIsOk = await VERIFY_AGGREGATED_FINALIZATION_PROOF(previousRangeAfp,checkpoint,global.SYMBIOTE_META.STATIC_STUFF_CACHE.get('QT_ROOTPUB'+checkpointFullID))

            // On this step, in case request asks us to vote for a range [A;B], we checked the AFP for block A-1

            let firstBlockInNewRangeIsNextToLatestInPreviousRange = checkpoint.id+':'+firstBlockInRange.creator+':'+(firstBlockInRange.index-1) === previousRangeAfp.blockID

            if(previousRangeAfpIsOk && firstBlockInNewRangeIsNextToLatestInPreviousRange){

                latestVotedHeightHandler.latestHash = previousRangeAfp.blockHash

                latestVotedHeightHandler.latestIndex = previousRangeAfp.index-1

            }

        }


        // New range for voting is [A;B]. The condition to continue the work and generate a valid signature for new proposed range is A === latestVotedHeight+1 && B > latestVotedHeight && B >= A

        if(firstBlockInRange.index === latestVotedHeightHandler.latestIndex+1 && firstBlockInRange.index <= lastBlockInRange.index && lastBlockInRange.index >= latestVotedHeightHandler.latestIndex){

            // First of all - check that the whole proposed segment is valid(e.g. each block contains the hash of previous one)
            // Also, check the structure of block

            let rangeCycleWasBreaked = false

            let prevIndexToCheck = latestVotedHeightHandler.latestIndex

            let prevHashToCheck = latestVotedHeightHandler.latestHash

            let atomicBatch = global.SYMBIOTE_META.BLOCKS.batch()
            

            for(let block of rangeOfBlocks){

                if(typeof block.index==='number' && typeof block.prevHash==='string' && block.creator === firstBlockInRange.creator && typeof block.sig==='string' && typeof block.extraData === 'object' && Array.isArray(block.transactions)){

                    let hash = Block.genHash(block)

                    let blockID = checkpoint.id+':'+firstBlockInRange.creator+':'+block.index

                    if(hash === prevHashToCheck && block.index-1 === prevIndexToCheck) {

                        // Update the values to check the whole range

                        prevHashToCheck = hash

                        prevIndexToCheck = block.index


                        /*

                            Here we also should check the validity of blocks 0 and 1

                            Block 0 must contain the AEFP for previous epoch to finish it
                            Block 1 must contain the AFP for the first block(with index 0) in epoch created by this pool
                        
                        */


                        // Also, if it's second block in epoch(index = 1,because numeration starts from 0) - make sure that we have AFP(aggregated finalization proofs) for the first block
                        // We'll need it for ASP
                        if(block.index===1){

                            let proofIsOk = false

                            if(typeof block.extraData.aggregatedFinalizationProofForFirstBlock === 'object'){

                                let rootPub = global.SYMBIOTE_META.STATIC_STUFF_CACHE.get('QT_ROOTPUB'+checkpointFullID)

                                let {blockID,blockHash,aggregatedPub,aggregatedSignature,afkVoters} = block.extraData.aggregatedFinalizationProofForFirstBlock

                                let blockIDForFirstBlock = checkpoint.id+':'+block.creator+':'+0

                                proofIsOk = blockID === blockIDForFirstBlock && await VERIFY_AGGREGATED_FINALIZATION_PROOF(block.extraData.aggregatedFinalizationProofForFirstBlock,checkpoint,rootPub)

                                if(proofIsOk){

                                    // Store locally
                    
                                    await global.SYMBIOTE_META.EPOCH_DATA.put('AFP:'+blockID,{blockID,blockHash,aggregatedPub,aggregatedSignature,afkVoters}).catch(()=>false)

                                }else{

                                    connection.close()

                                    return

                                } 


                            }

                        
                        }else if (block.index === 0 && checkpoint.id !== 0){


                            /*
        
                                And finally, if it's the first block in epoch - verify that it contains:
            
                                1) AGGREGATED_EPOCH_FINALIZATION_PROOF for previous epoch(in case we're not working on epoch 0) in block.extraData.aefpForPreviousEpoch
                                2) All the ASPs for previous pools in reassignment chains in section block.extraData.reassignments(in case the block creator is not a prime pool)

                                Also, these proofs should be only in the first block in epoch, so no sense to verify blocks with index !=0

                            */


                            //_________________________________________1_________________________________________


                            let aefpIsOk = await VERIFY_AGGREGATED_EPOCH_FINALIZATION_PROOF(
            
                                block.extraData.aefpForPreviousEpoch,
                                
                                checkpoint.quorum,
                                
                                GET_MAJORITY(checkpoint),
                                
                                global.SYMBIOTE_META.STATIC_STUFF_CACHE.get('QT_ROOTPUB'+checkpointFullID),
            
                                checkpointFullID
                                
                            ).catch(()=>false)


                            
                            //_________________________________________2_________________________________________

                            let reassignmentArray = checkpoint.reassignmentChains[primePoolPubKey]

                            let positionOfBlockCreatorInReassignmentChain = reassignmentArray.indexOf(block.creator)

                            let aspChainIsOk = itsPrimePool || await CHECK_ASP_CHAIN_VALIDITY(
            
                                primePoolPubKey,
            
                                block,
            
                                positionOfBlockCreatorInReassignmentChain,
            
                                checkpointFullID,
            
                                poolsRegistryOnQuorumThread,
            
                                'QUORUM_THREAD'
            
                            ).then(value=>value.isOK).catch(()=>false)


                            if(!aefpIsOk || !aspChainIsOk){

                                connection.close()

                                return
   
                            }

                        }


                        atomicBatch.put(blockID,block)


                    }else{

                        connection.close()

                        return

                    }

                }else{

                    connection.close()

                    return

                }                 

            }


            if(!rangeCycleWasBreaked){

                // Store the blocks & generate the signature for the last block in range

                await atomicBatch.write().then(async()=>{

                    // Now we can safely generate commitment for the last block in range without problems
                    
                    let lastBlockID = checkpoint.id+':'+lastBlockInRange.creator+':'+lastBlockInRange.index

                    let lastBlockHash = Block.genHash(lastBlockInRange)

                    let commitment = await BLS_SIGN_DATA(lastBlockID+lastBlockHash+checkpointFullID)

                    latestVotedHeightHandler.latestIndex = lastBlockInRange.index

                    latestVotedHeightHandler.latestHash = lastBlockHash

                    // Put to local storage to prevent double voting
                    await USE_TEMPORARY_DB('put',tempObject.DATABASE,'LATEST_VOTED_HEIGHT:'+firstBlockInRange.creator,latestVotedHeightHandler).then(()=>{

                        // Now we can remove the sync lock
                        tempObject.SYNCHRONIZER.delete('COM:'+firstBlockInRange.creator)

                        connection.sendUTF(JSON.stringify({voter:global.CONFIG.SYMBIOTE.PUB,commitment}))

                    }).catch(()=>

                        connection.close()

                    )

                }).catch(()=>{})

            }

        }

    }

    

}




let RETURN_FINALIZATION_PROOF_FOR_RANGE=async(parsedData,connection)=>{

    let checkpoint = global.SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT

    let checkpointFullID = checkpoint.hash+"#"+checkpoint.id

    let tempObject = global.SYMBIOTE_META.TEMP.get(checkpointFullID)

    // Check if we should accept this block.NOTE-use this option only in case if you want to stop accept blocks or override this process via custom runtime scripts or external services
        
    if(tempObject.SYNCHRONIZER.has('TIME_TO_NEW_EPOCH') || !tempObject){

        connection.close()
    
        return
    
    }


    //______________________________________________ Getting finalization proofs ______________________________________________

    // 2nd stage - accept aggregated commitments and response with the FINALIZATION_PROOF

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

    let aggregatedCommitments = parsedData

    if(!global.CONFIG.SYMBIOTE.ROUTE_TRIGGERS.MAIN.SHARE_FINALIZATION_PROOF){
    
        connection.close()
                   
        return
    
    }else{
    
        let {blockID,blockHash,aggregatedPub,aggregatedSignature,afkVoters} = aggregatedCommitments
    
        if(typeof aggregatedPub !== 'string' || typeof aggregatedSignature !== 'string' || typeof blockID !== 'string' || typeof blockHash !== 'string' || !Array.isArray(afkVoters)){
            
            connection.close()
    
            return
    
        }
    
        let blockCreator = blockID.split(':')[1]
            
        let poolIsAFK = tempObject.SKIP_HANDLERS.has(blockCreator) || tempObject.SYNCHRONIZER.has('CREATE_SKIP_HANDLER:'+blockCreator)
                
        if(poolIsAFK){
            
            connection.close()
                        
            return
    
        }
    
        let rootPub = global.SYMBIOTE_META.STATIC_STUFF_CACHE.get('QT_ROOTPUB'+checkpointFullID)
                    
        let dataThatShouldBeSigned = blockID+blockHash+checkpointFullID
    
        let majority = GET_MAJORITY(checkpoint)
            
        let reverseThreshold = checkpoint.quorum.length - majority
    
        let aggregatedCommitmentsIsOk = await bls.verifyThresholdSignature(
                    
            aggregatedPub,afkVoters,rootPub,dataThatShouldBeSigned,aggregatedSignature,reverseThreshold
                    
        ).catch(()=>false)
    
    
        
        
        if(aggregatedCommitmentsIsOk){
    
            let poolIsAFK2 = tempObject.SKIP_HANDLERS.has(blockCreator) || tempObject.SYNCHRONIZER.has('CREATE_SKIP_HANDLER:'+blockCreator)
            
            if(!tempObject.SYNCHRONIZER.has('FP:'+blockID) && !poolIsAFK2){
    
                // Sync flag
                tempObject.SYNCHRONIZER.set('FP:'+blockID,true)
    
                // Add the flag for function SUBCHAINS_HEALTH_MONITORING where we need to create skip handler to avoid async problems
                tempObject.SYNCHRONIZER.set('NO_FP_NOW:'+blockCreator,false)
    
                // eslint-disable-next-line no-unused-vars
                let [_,poolPubKey,index] = blockID.split(':')
    
                index=+index
                    
                let fpSignature = await BLS_SIGN_DATA(blockID+blockHash+'FINALIZATION'+checkpointFullID)                    
    
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
                        connection.sendUTF(JSON.stringify({voter:global.CONFIG.SYMBIOTE.PUB,fp:fpSignature}))
    
    
                    }).catch(()=>
    
                        connection.close()
    
                    )
    
    
                }else{
    
                    // Delete from sync mode
                    tempObject.SYNCHRONIZER.delete('FP:'+blockID)
    
                    // Make it possible to create skip handler in function SUBCHAINS_HEALTH_MONITORING
                    tempObject.SYNCHRONIZER.set('NO_FP_NOW:'+blockCreator,true)
    
                    // And finally - send response
                    connection.sendUTF(JSON.stringify({fp:fpSignature}))
    
                }
    
            }
    
    
        } else {
    
            connection.close()
       
            return                
    
        }
    
    }
        
}




let WebSocketServer = WS.server

let server = http.createServer({},(_,response)=>{

    response.writeHead(404);
    response.end();

})


server.listen(global.CONFIG.WEBSOCKET_PORT,global.CONFIG.WEBSOCKET_INTERFACE,()=>LOG({data:`Websocket server was activated on port \u001b[38;5;168m${global.CONFIG.WEBSOCKET_PORT}`},'CD'))


let WEBSOCKET_SERVER = new WebSocketServer({
    
    httpServer: server,

    // You should not use autoAcceptConnections for production
    // applications, as it defeats all standard cross-origin protection
    // facilities built into the protocol and the browser.  You should
    // *always* verify the connection's origin and decide whether or not
    // to accept it.
    autoAcceptConnections: false

})




WEBSOCKET_SERVER.on('request',request=>{

    let connection = request.accept('echo-protocol', request.origin)

    connection.on('message',message=>{

        if (message.type === 'utf8') {

            let data = JSON.parse(message.utf8Data)

            if(data.route==='get_finalization_proof_for_range'){

                RETURN_FINALIZATION_PROOF_FOR_RANGE(data.payload,connection)

            }else if(data.route==='tmb'){

                // For TMB(Trust Me Bro) requests
                

            }else if(data.route==='accept_afp'){

                //ACCEPT_AGGREGATED_FINALIZATION_PROOF(data.payload,connection)

            }
            else{

                connection.close(1337,'No available route. You can use <get_commitment_for_block_range> | <get_finalization_proof_for_range>')

            }

        }
    
    })
    
    connection.on('close',()=>{})

    connection.on('error',()=>{})

})




let BLS_PUBKEY_FOR_FILTER = global.CONFIG.SYMBIOTE.PRIME_POOL_PUBKEY || global.CONFIG.SYMBIOTE.PUB,




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


    let myLocalBlock = await global.SYMBIOTE_META.BLOCKS.get(blockID).catch(()=>false)

    let hashesAreEqual = myLocalBlock ? Block.genHash(myLocalBlock) === blockHash : false

    let quorumSignaIsOk = await VERIFY_AGGREGATED_FINALIZATION_PROOF(possibleAggregatedFinalizationProof,checkpoint,global.SYMBIOTE_META.STATIC_STUFF_CACHE.get('QT_ROOTPUB'+checkpointFullID))


    if(quorumSignaIsOk && hashesAreEqual){

        await global.SYMBIOTE_META.EPOCH_DATA.put('AFP:'+blockID,{blockID,blockHash,aggregatedPub,aggregatedSignature,afkVoters}).catch(()=>{})

        !response.aborted && response.end(JSON.stringify({status:'OK'}))

    }else !response.aborted && response.end(JSON.stringify({err:`Something wrong because all of 2 must be true => signa_is_ok:${quorumSignaIsOk} | hashesAreEqual:${hashesAreEqual}`}))


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
       
        let aggregatedFinalizationProof = await global.SYMBIOTE_META.EPOCH_DATA.get('AFP:'+blockID).catch(()=>false)


        if(aggregatedFinalizationProof){

            !response.aborted && response.end(JSON.stringify(aggregatedFinalizationProof))

        }else !response.aborted && response.end(JSON.stringify({err:'No proof'}))

    }else !response.aborted && response.end(JSON.stringify({err:'Route is off'}))

},





/*
            
    The structure of AGGREGATED_EPOCH_FINALIZATION_PROOF is

    {
        lastAuthority:<index of BLS pubkey of some pool in subchain's reassignment chain>,
        lastIndex:<index of his block in previous epoch>,
        lastHash:<hash of this block>,
        firstBlockHash,
        
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

        let aggregatedEpochFinalizationProofForSubchain = await global.SYMBIOTE_META.EPOCH_DATA.get(`AEFP:${epochIndex}:${subchainID}`).catch(()=>false)


        if(aggregatedEpochFinalizationProofForSubchain){

            !response.aborted && response.end(JSON.stringify(aggregatedEpochFinalizationProofForSubchain))

        }else !response.aborted && response.end(JSON.stringify({err:'No EFP'}))

    }else !response.aborted && response.end(JSON.stringify({err:'Route is off'}))

},




VERIFY_AGGREGATED_COMMITMENTS_AND_CHANGE_LOCAL_DATA = async(proposition,checkpoint,pubKeyOfCurrentAuthorityOnSubchain,reassignmentForThisSubchain,tempObject,subchainID,checkpointManagerForAuthority,responseStructure,firstBlockHash) => {

    let checkpointFullID = checkpoint.hash+'#'+checkpoint.id

    let {index,hash,aggregatedCommitments} = proposition.finalizationProof

    let {aggregatedPub,aggregatedSignature,afkVoters} = aggregatedCommitments

    let rootPub = global.SYMBIOTE_META.STATIC_STUFF_CACHE.get('QT_ROOTPUB'+checkpointFullID)

    let dataThatShouldBeSigned = `${checkpoint.id}:${pubKeyOfCurrentAuthorityOnSubchain}:${index}`+hash+checkpointFullID // typical commitment signature blockID+hash+checkpointFullID

    let majority = GET_MAJORITY(checkpoint)

    let reverseThreshold = checkpoint.quorum.length-majority

    let isOk = await bls.verifyThresholdSignature(aggregatedPub,afkVoters,rootPub,dataThatShouldBeSigned,aggregatedSignature,reverseThreshold).catch(()=>false)


    if(isOk){

        if(reassignmentForThisSubchain) reassignmentForThisSubchain.currentAuthority = proposition.currentAuthority

        else tempObject.REASSIGNMENTS.set(subchainID,{currentAuthority:proposition.currentAuthority})


        if(checkpointManagerForAuthority){

            checkpointManagerForAuthority.index = index

            checkpointManagerForAuthority.hash = hash

            checkpointManagerForAuthority.aggregatedCommitments = aggregatedCommitments

        }else tempObject.CHECKPOINT_MANAGER.set(pubKeyOfCurrentAuthorityOnSubchain,{index,hash,aggregatedCommitments})

        // Generate EPOCH_FINALIZATION_PROOF_SIGNATURE

        let dataToSign = 'EPOCH_DONE'+proposition.currentAuthority+index+hash+firstBlockHash+checkpointFullID

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

        !response.aborted && response.end(JSON.stringify({err:'This checkpoint is not ready for checkpoint'}))

        return

    }
    


    /* 
    
        Parse the checkpoint proposition

        !Reminder:  The structure of checkpoint proposition is(see life.js/CHECK_IF_ITS_TIME_TO_PROPOSE_CHECKPOINT function):

        {
                
            "subchain0":{

                currentAuth:<int - pointer to current authority of subchain based on QT.CHECKPOINT.reassignmentChains[primePool]. In case -1 - it's prime pool>
                
                afpForFirstBlock:{

                    blockID,
                    blockHash,
                    aggregatedSignature:<>, // blockID+hash+'FINALIZATION'+QT.CHECKPOINT.HASH+"#"+QT.CHECKPOINT.id
                    aggregatedPub:<>,
                    afkVoters

                },

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
                
                2) If proposed height >= local version - generate and return signature SIG('EPOCH_DONE'+lastAuth+lastIndex+lastHash+firstBlockHash+checkpointFullId)

                3) Else - send status:'UPGRADE' with local version of finalization proof, index and hash

            [Else if proposed.currentAuth < local.currentAuth AND tempObj.CHECKPOINT_MANAGER.has(local.currentAuth)]:

                1) Send status:'UPGRADE' with local version of currentAuthority, finalization proof, index and hash



        !Reminder: Response structure is

        {
            
            subchainA:{
                                
                status:'UPGRADE'|'OK',

                -------------------------------[In case 'OK']-------------------------------

                signa: SIG('EPOCH_DONE'+lastAuth+lastIndex+lastHash+firstBlockHash+checkpointFullId)
                        
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

            if(typeof subchainID === 'string' && typeof proposition.currentAuthority === 'number' && typeof proposition.afpForFirstBlock === 'object' && typeof proposition.finalizationProof === 'object' && typeof proposition.finalizationProof.aggregatedCommitments === 'object'){

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


                // Verify the AFP for first block
                // But, in case the skip index is -1 - sign the nullHash(0123...) and in case skip index is 0 - sign the proposition.finalizationProof.hash
                        
                let firstBlockHash

                if(proposition.finalizationProof.index > 0){

                    // Verify the AFP for first block

                    let afpIsOk = await VERIFY_AGGREGATED_FINALIZATION_PROOF(proposition.afpForFirstBlock,qtCheckpoint,global.SYMBIOTE_META.STATIC_STUFF_CACHE.get('QT_ROOTPUB'+checkpointFullID))

                    if(afpIsOk) firstBlockHash = proposition.afpForFirstBlock.blockHash

                }else if(proposition.finalizationProof.index === 0) firstBlockHash = proposition.finalizationProof.hash

                else if(proposition.finalizationProof.index === -1) firstBlockHash = '0123456701234567012345670123456701234567012345670123456701234567'


                if(!firstBlockHash) continue


                //_________________________________________ Now compare _________________________________________

                if(proposition.currentAuthority === localIndexOfAuthority){

                    if(checkpointManagerForAuthority.index === proposition.finalizationProof.index && checkpointManagerForAuthority.hash === proposition.finalizationProof.hash){
                        
                        // Send EPOCH_FINALIZATION_PROOF signature

                        let {index,hash} = proposition.finalizationProof

                        let dataToSign = 'EPOCH_DONE'+proposition.currentAuthority+index+hash+firstBlockHash+checkpointFullID
    
                        responseStructure[subchainID] = {
                                                
                            status:'OK',
                                            
                            sig:await BLS_SIGN_DATA(dataToSign)
                                            
                        }

                            
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

                        responseStructure,

                        firstBlockHash
                        
                    )

                }else if(checkpointManagerForAuthority.index > proposition.finalizationProof.index){

                    // Send 'UPGRADE' msg

                    responseStructure[subchainID] = {

                        status:'UPGRADE',
                            
                        currentAuthority:localIndexOfAuthority,
                
                        finalizationProof:checkpointManagerForAuthority
                    
                    }

                }


            }


        }

        !response.aborted && response.end(JSON.stringify(responseStructure))

    }else !response.aborted && response.end(JSON.stringify({err:'Wrong format'}))


}),




// Function to return signature of reassignment proof if we have SKIP_HANDLER for requested subchain. Return the signature if requested INDEX >= than our own or send UPDATE message with FINALIZATION_PROOF 

/*


[Accept]:

    {

        poolPubKey,

        subchain

        aggregatedFinalizationProofForFirstBlock:{

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


[1] In case we have skip handler for this pool in SKIP_HANDLERS and if <extendedAggregatedCommitments> in skip handler has <= index than in FP from request we can response

    Also, bear in mind that we need to sign the hash of ASP for previous pool (field <previousAspInRcHash>). We need this to verify the chains of ASPs by hashes nor BLS signatures.



    This will save us in case of a large number of ASPs that need to be checked
    
    Inserting an ASP hash for a pool that is 1 position earlier allows us to check only 1 signature and N hashes in the ASP chain
    
    Compare this to having to verify N aggregated signatures
    
    Obviously, the hash generation time and comparison with the <previousAspHash> field is cheaper than checking the aggregated signature (if considered within the O notation)
        

    Finally, we'll send this object as response

    {
        type:'OK',
        sig: BLS_SIG('SKIP:<poolPubKey>:<previousAspInRcHash>:<firstBlockHash>:<index>:<hash>:<checkpointFullID>')
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


    + check the aggregated commitments (AC) in section <aggregatedFinalizationProofForFirstBlock>. Generate reassignment proofs only in case this one is valid


*/
getReassignmentProof=response=>response.writeHeader('Access-Control-Allow-Origin','*').onAborted(()=>response.aborted=true).onData(async bytes=>{

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

    
    let requestForSkipProof = await BODY(bytes,global.CONFIG.MAX_PAYLOAD_SIZE)


    if(typeof requestForSkipProof === 'object' && checkpoint.reassignmentChains[requestForSkipProof.subchain] && mySkipHandlers.has(requestForSkipProof.poolPubKey) && typeof requestForSkipProof.extendedAggregatedCommitments === 'object'){

        
        
        let {index,hash,aggregatedCommitments} = requestForSkipProof.extendedAggregatedCommitments

        let localSkipHandler = mySkipHandlers.get(requestForSkipProof.poolPubKey)



        // We can't sign the reassignment proof in case requested height is lower than our local version of aggregated commitments. So, send 'UPDATE' message
        if(localSkipHandler.extendedAggregatedCommitments.index > index){

            let responseData = {
                
                type:'UPDATE',

                extendedAggregatedCommitments:localSkipHandler.extendedAggregatedCommitments

            }

            !response.aborted && response.end(JSON.stringify(responseData))


        }else{

           
            //________________________________________________ Verify aggregated commitments ________________________________________________

            
            let aggregatedCommitmentsIsOk = false

            if(index > -1){

                if(typeof aggregatedCommitments === 'object'){

                    // Otherwise we can generate reassignment proof(signature) and return. But, anyway - check the <aggregatedCommitments> in request

                    let {aggregatedPub,aggregatedSignature,afkVoters} = aggregatedCommitments
                    
                    let dataThatShouldBeSigned = (checkpoint.id+':'+requestForSkipProof.poolPubKey+':'+index)+hash+checkpointFullID

                    aggregatedCommitmentsIsOk = await bls.verifyThresholdSignature(aggregatedPub,afkVoters,qtRootPub,dataThatShouldBeSigned,aggregatedSignature,reverseThreshold).catch(()=>false)

                }

            }else aggregatedCommitmentsIsOk = true

            
            if(!aggregatedCommitmentsIsOk){

                !response.aborted && response.end(JSON.stringify({err:'Wrong aggregated signature for skipIndex > -1'}))

                return

            }


            //____________________________________________ Verify the proof for first block ________________________________________________
            

            let dataToSignForSkipProof, firstBlockProofIsOk = false


            /*
            
                We also need the hash of ASP for previous pool

                In case index === -1 it's a signal that no block was created, so no ASPs for previous pool. Sign the nullhash(0123456789ab...)

                Otherwise - find block, compare it's hash with <requestForSkipProof.aggregatedFinalizationProofForFirstBlock> or <hash>(index===0)

                In case hashes match - extract the ASP for pool <checkpoint.reassignmentChains[subchain][indexOfThis-1]>, get the hash and paste this hash to <dataToSignForSkipProof>
            

            */

            let indexInReassignmentChainForRequestedPool = checkpoint.reassignmentChains[requestForSkipProof.subchain].indexOf(requestForSkipProof.poolPubKey)

            let previousPoolPubKey = checkpoint.reassignmentChains[requestForSkipProof.subchain][indexInReassignmentChainForRequestedPool-1] || requestForSkipProof.subchain


            if(index === -1){

                // If skipIndex is -1 then sign the hash '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'(null,default hash) as the hash of firstBlockHash
                
                dataToSignForSkipProof = `SKIP:${requestForSkipProof.poolPubKey}:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef:${index}:${hash}:${checkpointFullID}`

                firstBlockProofIsOk = true

            }else if(index === 0){

                // If skipIndex is 0 then sign the hash of block 0

                let block = await GET_MANY_BLOCKS(checkpoint.id,requestForSkipProof.poolPubKey,0)

                if(block && Block.genHash(block) === hash){

                    let aspForPreviousPool = block.extraData.reassignments[previousPoolPubKey]

                    dataToSignForSkipProof = `SKIP:${requestForSkipProof.poolPubKey}:${BLAKE3(JSON.stringify(aspForPreviousPool))}:${hash}:${index}:${hash}:${checkpointFullID}`

                    firstBlockProofIsOk = true
    
                }

            }else if(index > 0 && typeof requestForSkipProof.aggregatedFinalizationProofForFirstBlock === 'object'){

                // Verify the aggregatedFinalizationProofForFirstBlock in case skipIndex > 0

                let blockIdOfFirstBlock = checkpoint.id+':'+requestForSkipProof.poolPubKey+':0'

                let {blockHash,aggregatedPub,aggregatedSignature,afkVoters} = requestForSkipProof.aggregatedFinalizationProofForFirstBlock

                let dataThatShouldBeSigned = blockIdOfFirstBlock+blockHash+'FINALIZATION'+checkpointFullID
            
                let aggregatedFinalizationProofIsOk = await bls.verifyThresholdSignature(aggregatedPub,afkVoters,qtRootPub,dataThatShouldBeSigned,aggregatedSignature,reverseThreshold).catch(()=>false)

                if(aggregatedFinalizationProofIsOk){

                    let block = await GET_MANY_BLOCKS(checkpoint.id,requestForSkipProof.poolPubKey,0)

                    if(block && Block.genHash(block) === blockHash){

                        let aspForPreviousPool = block.extraData.reassignments[previousPoolPubKey]

                        dataToSignForSkipProof = `SKIP:${requestForSkipProof.poolPubKey}:${BLAKE3(JSON.stringify(aspForPreviousPool))}:${blockHash}:${index}:${hash}:${checkpointFullID}`

                        firstBlockProofIsOk = true                    
    
                    }

                }

            }
            
            // If proof is ok - generate reassignment proof

            if(firstBlockProofIsOk){

                let skipMessage = {
                    
                    type:'OK',

                    sig:await BLS_SIGN_DATA(dataToSignForSkipProof)
                }

                !response.aborted && response.end(JSON.stringify(skipMessage))

                
            }else !response.aborted && response.end(JSON.stringify({err:`Wrong signatures => aggregatedCommitmentsIsOk:${aggregatedCommitmentsIsOk} | firstBlockProofIsOk:${firstBlockProofIsOk}`}))

             
        }


    }else !response.aborted && response.end(JSON.stringify({err:'Wrong format'}))


}),




/*

[Info]: Once quorum member who already have ASP get the 2/3N+1 approvements for reassignment it can produce commitments, finalization proofs for the next reserve pool in (QT/VT).CHECKPOINT.REASSIGNMENT_CHAINS[<primePool>] and start to monitor health for this pool

[Accept]:

{

    subchain:primePoolPubKey,
    indexOfNext,
    session:<32-bytes hex string>

}


[Response]:

If we also have an <aggregatedSkipProof> in our local SKIP_HANDLERS[<poolPubKey>] - we can vote for reassignment:

Response => {type:'OK',sig:SIG(`REASSIGNMENT:<poolPubKey>:<session>:<checkpointFullID>`)}

Otherwise => {type:'ERR'}

*/
getReassignmentReadyStatus=response=>response.writeHeader('Access-Control-Allow-Origin','*').onAborted(()=>response.aborted=true).onData(async bytes=>{

    let qtCheckpoint  = global.SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT

    let checkpointFullID = qtCheckpoint.hash+"#"+qtCheckpoint.id

    let tempObject = global.SYMBIOTE_META.TEMP.get(checkpointFullID)

    if(!tempObject){

        !response.aborted && response.end(JSON.stringify({err:'Checkpoint is not fresh'}))

        return
    }

    
    let {subchain,indexOfNext,session} = await BODY(bytes,global.CONFIG.PAYLOAD_SIZE)


    if(typeof subchain === 'string' && typeof indexOfNext === 'number' && typeof session === 'string' && session.length === 64 && qtCheckpoint.reassignmentChains[subchain]){

        let targetPoolPubKey = qtCheckpoint.reassignmentChains[subchain][indexOfNext]

        let skipHandler = tempObject.SKIP_HANDLERS.get(targetPoolPubKey)

        let weHaveSentAlertToThisPool = tempObject.TEMP_CACHE.get(`SENT_ALERT:${subchain}:${indexOfNext}`) || await USE_TEMPORARY_DB('get',tempObject.DATABASE,`SENT_ALERT:${subchain}:${indexOfNext}`).catch(()=>false)


        if(skipHandler && skipHandler.aggregatedSkipProof && weHaveSentAlertToThisPool){
    
            let signatureToResponse = await BLS_SIGN_DATA(`REASSIGNMENT:${targetPoolPubKey}:${session}:${checkpointFullID}`)
    
            !response.aborted && response.end(JSON.stringify({type:'OK',sig:signatureToResponse}))
    
        }else !response.aborted && response.end(JSON.stringify({type:'ERR'}))
    

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

[2] afpForFirstBlockByCurrentAuthority - default AFP structure -> 


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

        let currentPrimePools = checkpoint.poolsRegistry.primePools // [primePool0, primePool1, ...]

        let templateForResponse = {} // primePool => {currentAuthorityIndex,firstBlockByCurrentAuthority,afpForFirstBlockByCurrentAuthority}

        for(let primePool of currentPrimePools){

            // Get the current authority

            let reassignmentHandler = tempObject.REASSIGNMENTS.get(primePool) // primePool => {currentAuthority:<number>}

            if(reassignmentHandler){

                let currentAuthorityIndex = reassignmentHandler.currentAuthority

                let currentSubchainAuthority = currentAuthorityIndex === -1 ? primePool : checkpoint.reassignmentChains[primePool][currentAuthorityIndex]

                // Now get the first block & AFP for it

                let firstBlockID = quorumThreadCheckpointIndex+':'+currentSubchainAuthority+':0'

                let firstBlockByCurrentAuthority = await global.SYMBIOTE_META.BLOCKS.get(firstBlockID).catch(()=>false)

                if(firstBlockByCurrentAuthority){

                    // Finally, find the AFP for this block

                    let afpForFirstBlockByCurrentAuthority = await global.SYMBIOTE_META.EPOCH_DATA.get('AFP:'+firstBlockID).catch(()=>false)

                    // Put to response

                    templateForResponse[primePool]={

                        currentAuthorityIndex,
                        
                        firstBlockByCurrentAuthority,
                        
                        afpForFirstBlockByCurrentAuthority
                        
                    }

                }

            }

        }

        // Finally, send the <templateForResponse> back

        !response.aborted && response.end(JSON.stringify(templateForResponse))


    }else !response.aborted && response.end(JSON.stringify({err:'Route is off'}))

},




/*


Function to return the current information about authorities on subchains


[Params]:

    Nothing

[Returns]:

    {
        "subchain0":{

            currentAuthorityIndex:<number>,

            aspForPrevious:{

                firstBlockHash,

                (?) tmbIndex,

                (?) tmbHash,

                skipIndex,

                skipHash,

                aggregatedPub:bls.aggregatePublicKeys(<quorum members pubkeys who signed msg>),

                aggregatedSignature:bls.aggregateSignatures('SKIP:<poolPubKey>:<firstBlockHash>:<skipIndex>:<skipHash>:<checkpointFullID>'),

                afkVoters:checkpoint.quorum.filter(pubKey=>!pubkeysWhoAgreeToSkip.includes(pubKey))

            }

        }
    }


*/
getCurrentSubchainAuthorities = async response => {

    response.onAborted(()=>response.aborted=true)

    if(global.CONFIG.SYMBIOTE.ROUTE_TRIGGERS.MAIN.GET_CURRENT_SUBCHAINS_AUTHORITIES){

        let checkpoint = global.SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT

        let quorumThreadCheckpointFullID = checkpoint.hash+"#"+checkpoint.id

        let tempObject = global.SYMBIOTE_META.TEMP.get(quorumThreadCheckpointFullID)

        if(!tempObject){
    
            !response.aborted && response.end(JSON.stringify({err:'QT checkpoint is not ready'}))
    
            return
        }

        // Get the current authorities for subchains from REASSIGNMENTS

        let currentPrimePools = checkpoint.poolsRegistry.primePools // [primePool0, primePool1, ...]

        let templateForResponse = {} // primePool => {currentAuthorityIndex,firstBlockByCurrentAuthority,afpForFirstBlockByCurrentAuthority}

        for(let primePool of currentPrimePools){

            // Get the current authority

            let reassignmentHandler = tempObject.REASSIGNMENTS.get(primePool) // primePool => {currentAuthority:<number>}

            if(reassignmentHandler){

                let currentAuthorityIndex = reassignmentHandler.currentAuthority

                // Also, we need to send the ASP for previous pool in reassignment chain as a proof of valid move to current authority

                let aspForPrevious

                if(currentAuthorityIndex === 0){

                    // If current authority is 0 this is a signal that previous was prime pool (index = -1)

                    aspForPrevious = tempObject.SKIP_HANDLERS.get(primePool)?.aggregatedSkipProof

                }else if (currentAuthorityIndex > 0){

                    let previousAuthorityPubKey = checkpoint.reassignmentChains[primePool][currentAuthorityIndex-1]

                    aspForPrevious = tempObject.SKIP_HANDLERS.get(previousAuthorityPubKey)?.aggregatedSkipProof

                }

                templateForResponse[primePool] = {currentAuthorityIndex,aspForPrevious}

            }

        }

        // Finally, send the <templateForResponse> back

        !response.aborted && response.end(JSON.stringify(templateForResponse))


    }else !response.aborted && response.end(JSON.stringify({err:'Route is off'}))

},




/*


[Info]:

    Handler to accept ASP and start the instant reassignment procedure

[Accept]:

    {
        subchain:<subchain ID - pubkey of prime pool>,

        shouldBeThisAuthority:<number>

        aspsForPreviousPools:{

            "poolPubKeyX":{

                firstBlockHash,

                skipIndex,

                skipHash,

                aggregatedPub:bls.aggregatePublicKeys(<quorum members pubkeys who signed msg>),

                aggregatedSignature:bls.aggregateSignatures('SKIP:<poolPubKey>:<firstBlockHash>:<skipIndex>:<skipHash>:<checkpointFullID>'),

                afkVoters:checkpoint.quorum.filter(pubKey=>!pubkeysWhoAgreeToSkip.includes(pubKey))

            },


            "poolPubKeY":{

                firstBlockHash,

                skipIndex,

                skipHash,

                aggregatedPub:bls.aggregatePublicKeys(<quorum members pubkeys who signed msg>),

                aggregatedSignature:bls.aggregateSignatures('SKIP:<poolPubKey>:<firstBlockHash>:<skipIndex>:<skipHash>:<checkpointFullID>'),

                afkVoters:checkpoint.quorum.filter(pubKey=>!pubkeysWhoAgreeToSkip.includes(pubKey))

            },

            ... (we need to send ASPs for all the pools from index <shouldBeThisAuthority-1> until the beginning of reassignment chain. We can stop when .skipIndex of some ASP won't be -1)


        }

    }

    _________________________ What to do next _________________________

    1) Check the current authorities on proposed subchain => for(let primePool in checkpoint.poolsRegistry.primePools) => tempObject.REASSIGNMENTS.get(primePool)

    2) In case local.currentAuthority < obj[<subchain>].shouldBeThisAuthority => verify the ASP

    3) The ASP must be OK for previous pool => checkpoint.reassignmentChains[subchain][shouldBeThisAuthority-1]
    
    4) In case ASP is ok - create the CREATE_REASSIGNMENT request and push it to tempObject.SYNCHRONIZER to update the local info about reassignment

    5) Inside function REASSIGN_PROCEDURE_MONITORING check the requests and update the local reassignment data


*/
acceptReassignment=response=>response.writeHeader('Access-Control-Allow-Origin','*').onAborted(()=>response.aborted=true).onData(async bytes=>{

    let checkpoint = global.SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT

    let checkpointFullID = checkpoint.hash+"#"+checkpoint.id

    let tempObject = global.SYMBIOTE_META.TEMP.get(checkpointFullID)

    if(!tempObject){

        !response.aborted && response.end(JSON.stringify({err:'Checkpoint is not fresh'}))

        return
    }


    
    let possibleReassignmentPropositionForSubchain = await BODY(bytes,global.CONFIG.EXTENDED_PAYLOAD_SIZE)


    if(typeof possibleReassignmentPropositionForSubchain === 'object'){


        // Parse reassignment proposition
        let {subchain,shouldBeThisAuthority,aspsForPreviousPools} = possibleReassignmentPropositionForSubchain


        if(typeof subchain !== 'string' || !checkpoint.poolsRegistry.primePools.includes(subchain) || typeof shouldBeThisAuthority !== 'number' || typeof aspsForPreviousPools !== 'object'){

            !response.aborted && response.end(JSON.stringify({err:'Wrong format of proposition components or no such subchain'}))

            return

        }

        let localRcHandlerForSubchain = tempObject.REASSIGNMENTS.get(subchain) || {currentAuthority:-1}

        // Compare the .currentAuthority indexes to make sure that proposed authority has the bigger index 

        if(localRcHandlerForSubchain.currentAuthority < shouldBeThisAuthority){

            // Verify the ASP for pool with index <shouldBeThisAuthority-1> in reassignment chain
            // If ok - create the CREATE_REASSIGNMENT:<subchain> request and push to synchronizer
            // Due to Node.js work principles - check the indexes right before push

            let pubKeyOfSkippedPool = checkpoint.reassignmentChains[subchain][shouldBeThisAuthority-1] || subchain

            let aspForSkippedPool = aspsForPreviousPools[pubKeyOfSkippedPool]

            let aspIsOk = await CHECK_AGGREGATED_SKIP_PROOF_VALIDITY(pubKeyOfSkippedPool,aspForSkippedPool,checkpointFullID,checkpoint,'QUORUM_THREAD')
            
            if(aspIsOk) {

                let indexInReassignmentChain = shouldBeThisAuthority-2 // -2 because we checked -1 position

                while(indexInReassignmentChain >= -1){

                    let currentPoolToVerify = checkpoint.reassignmentChains[subchain][indexInReassignmentChain] || subchain

                    let nextPoolInRC = checkpoint.reassignmentChains[subchain][indexInReassignmentChain+1]

                    let nextAspInChain = aspsForPreviousPools[nextPoolInRC]

                    // First of all - check if we already have ASP locally. If so, skip verification because we already have a valid & verified ASP

                    let currentAspToVerify = aspsForPreviousPools[currentPoolToVerify]

                    let currentAspIsOk = BLAKE3(JSON.stringify(currentAspToVerify) === nextAspInChain.previousAspHash)

 
                    if(currentAspIsOk){

                        // Verify all the ASP until skipIndex != -1
                        if(currentAspToVerify.skipIndex > -1) break // no sense to verify more

                        indexInReassignmentChain -- // otherwise - move to previous pool in rc

                    }else{

                        !response.aborted && response.end(JSON.stringify({err:'Wrong ASP in chain'}))

                        return

                    }

                }

                /*
                
                    Create the request to update the local reassignment data
                
                    But, finally check if no other request for reassignment wasn't accepted in async mode via concurrent request to this handler
                    
                    Node.js will read the data from mapping, compare .shouldBeThisAuthority property and add new request in case index is bigger - and all these ops in sync mode
                
                */
                
                let concurrentRequest = tempObject.SYNCHRONIZER.get('CREATE_REASSIGNMENT:'+subchain)


                if(!concurrentRequest || concurrentRequest && concurrentRequest.shouldBeThisAuthority < shouldBeThisAuthority){

                    tempObject.SYNCHRONIZER.set('CREATE_REASSIGNMENT:'+subchain,{shouldBeThisAuthority,aspsForPreviousPools})

                }

                !response.aborted && response.end(JSON.stringify({status:'OK'}))

            } else !response.aborted && response.end(JSON.stringify({err:'One of ASP is wrong'}))

        } else !response.aborted && response.end(JSON.stringify({err:'Local version of current subchain authority has the bigger index'}))

    }else !response.aborted && response.end(JSON.stringify({err:'Wrong format'}))


}),




/*

Body is


{
    
    type:<operation id> ===> STAKING_CONTRACT_CALL | SLASH_UNSTAKE | UPDATE_RUBICON , etc. See ../systemOperationsVerifiers.js
    
    payload:{}

}

    * Payload has different structure depending on type of SSO


*/

systemSyncOperationsVerifier=response=>response.writeHeader('Access-Control-Allow-Origin','*').onAborted(()=>response.aborted=true).onData(async bytes=>{

    
    let systemSyncOperation = await BODY(bytes,global.CONFIG.MAX_PAYLOAD_SIZE)

    let checkpointFullID = global.SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT.hash+"#"+global.SYMBIOTE_META.QUORUM_THREAD.CHECKPOINT.id


    if(!global.SYMBIOTE_META.TEMP.has(checkpointFullID)){

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


    if(!global.SYMBIOTE_META.TEMP.has(checkpointFullID)){

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




// Format of body : <transaction>
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

    
    if(global.SYMBIOTE_META.MEMPOOL.length < global.CONFIG.SYMBIOTE.TXS_MEMPOOL_SIZE){

        let filteredEvent=await global.SYMBIOTE_META.FILTERS[transaction.type](transaction,BLS_PUBKEY_FOR_FILTER)

        if(filteredEvent){

            !response.aborted && response.end(JSON.stringify({status:'OK'}))

            global.SYMBIOTE_META.MEMPOOL.push(filteredEvent)
                        
        }else !response.aborted && response.end(JSON.stringify({err:`Can't get filtered value of tx`}))

    }else !response.aborted && response.end(JSON.stringify({err:'Mempool is fullfilled'}))

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








global.UWS_SERVER


//_______________________________ Consensus related routes _______________________________


// 3rd stage - logic with super finalization proofs. Accept AGGREGATED_FINALIZATION_PROOF(aggregated 2/3N+1 FINALIZATION_PROOFs from QUORUM members)
.post('/aggregated_finalization_proof',acceptAggregatedFinalizationProof)

// Just GET route to return the AFP for block by it's id (reminder - BlockID structure is <epochID>:<blockCreatorPubKey>:<index of block in this epoch>)
.get('/aggregated_finalization_proof/:BLOCK_ID',getAggregatedFinalizationProof)



//_______________________________ Routes for checkpoint _______________________________



// Simple GET handler to return AEFP for given subchain and epoch
.get('/aggregated_epoch_finalization_proof/:EPOCH_INDEX/:SUBCHAIN_ID',getAggregatedEpochFinalizationProof)

// Handler to acccept checkpoint propositions for subchains and return agreement to build AEFP - Aggregated Epoch Finalization Proof
.post('/checkpoint_proposition',acceptCheckpointProposition)



//______________________ Routes related to the reassignment procedure _________________________



// Function to return signature of reassignment proof if we have SKIP_HANDLER for requested pool. Return the signature if requested INDEX >= than our own or send UPDATE message with AGGREGATED_COMMITMENTS 
.post('/get_reassignment_proof',getReassignmentProof)

// Once quorum member who already have ASP get the 2/3N+1 approvements for reassignment it can produce commitments, finalization proofs for the next reserve pool in (QT/VT).CHECKPOINT.reassignmentChains[<primePool>] and start to monitor health for this pool
.post('/get_reassignment_ready_status',getReassignmentReadyStatus)

// We need this route for function TEMPORARY_REASSIGNMENTS_BUILDER() to build temporary reassignments. This function just return the ASP for some pools(if ASP exists locally)
.get('/get_data_for_temp_reassign',getDataForTempReassignments)

// Get current subchains' authorities based on reassignment chains of current epoch
.get('/get_current_subchain_authorities',getCurrentSubchainAuthorities)

// Handler to accept ASPs and to start forced reassignment
.post('/accept_reassignment',acceptReassignment)



//___________________________________ Other ___________________________________________



// Handler to accept system sync operation, verify it and sign if OK. The caller is SSO creator while verifiers - current quorum members
.post('/sign_system_sync_operation',systemSyncOperationsVerifier)

// Handler to accept SSO with 2/3N+1 aggregated agreements which proves that majority of current quorum verified this SSO and we can add it to block header
.post('/system_sync_operation_to_mempool',systemSyncOperationToMempool)

// Handler to accept transaction, make overview and add to mempool
.post('/transaction',acceptTransactions)

// Handler to accept peers to exchange data with
.post('/addpeer',addPeer)