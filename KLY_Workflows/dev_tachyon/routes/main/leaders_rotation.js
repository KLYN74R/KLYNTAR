import {getVerifiedAggregatedFinalizationProofByBlockId, verifyAggregatedFinalizationProof} from '../../common_functions/work_with_proofs.js'

import {BLOCKCHAIN_DATABASES, EPOCH_METADATA_MAPPING, WORKING_THREADS} from '../../blockchain_preparation.js'

import {CONFIGURATION, FASTIFY_SERVER} from '../../../../klyn74r.js'

import {getBlock} from '../../verification_process/verification.js'

import {signEd25519} from '../../../../KLY_Utils/utils.js'

import Block from '../../structures/block.js'





/*


[Info]:

    Function to return signature of rotation proof if we have SKIP_HANDLER for requested shard
    
    Returns the signature if requested height to skip >= than our own
    
    Otherwise - send the UPDATE message with FINALIZATION_PROOF 



[Accept]:

    {

        poolPubKey,

        shard

        afpForFirstBlock:{

            prevBlockHash
            blockID,    => epochID:poolPubKey:0
            blockHash,
            proofs:{

                pubkey0:signa0,         => SIG(prevBlockHash+blockID+blockHash+QT.EPOCH.HASH+"#"+QT.EPOCH.id)
                ...
                pubkeyN:signaN

            }

        }

        skipData:{

            index,
            hash,

            afp:{
                
                prevBlockHash,
                blockID,
                blockHash,

                proofs:{
                     
                    pubKey0:signa0,         => prevBlockHash+blockID+hash+QT.EPOCH.HASH+"#"+QT.EPOCH.id
                    ...
                        
                }

            }

        }

    }


[Response]:


[1] In case we have skip handler for this pool in SKIP_HANDLERS and if <skipData> in skip handler has <= index than in <skipData> from request we can response

    Also, bear in mind that we need to sign the hash of ASP for previous pool (field <previousAspHash>). We need this to verify the chains of ASPs by hashes not signatures.



    This will save us in case of a large number of ASPs that need to be checked
    
    Inserting an ASP hash for a pool that is 1 position earlier allows us to check only 1 signature and N hashes in the ASP chain
    
    Compare this with a case when we need to verify N signatures
    
    Obviously, the hash generation time and comparison with the <previousAspHash> field is cheaper than checking the aggregated signature (if considered within the O notation)
        

    Finally, we'll send this object as response

    {
        type:'OK',
        sig: ED25519_SIG('LEADER_ROTATION_PROOF:<poolPubKey>:<firstBlockHash>:<index>:<hash>:<epochFullID>')
    }


[2] In case we have bigger index in skip handler than in proposed <skipData> - response with 'UPDATE' message:

    {
        type:'UPDATE',
                        
        skipData:{

            index,
            hash,

            afp:{
                
                prevBlockHash,
                blockID,
                blockHash,

                proofs:{
                     
                    pubKey0:signa0,         => prevBlockHash+blockID+blockHash+QT.EPOCH.hash+"#"+QT.EPOCH.id
                    ...
                        
                }

            }

        }
                        
    }
    

*/

// Function to return signature of proof that we've changed the leader for some shard. Returns the signature if requested FINALIZATION_STATS.index >= than our own or send UPDATE message✅

FASTIFY_SERVER.post('/leader_rotation_proof',{bodyLimit:CONFIGURATION.NODE_LEVEL.MAX_PAYLOAD_SIZE},async(request,response)=>{

    let epochHandler = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH

    let epochFullID = epochHandler.hash+"#"+epochHandler.id

    let currentEpochMetadata = EPOCH_METADATA_MAPPING.get(epochFullID)

    if(!currentEpochMetadata){

        response.send({err:'Epoch handler on QT is not ready'})

        return
    }



    let requestForLeaderRotationProof = JSON.parse(request.body)

    let overviewIsOk    

    overviewIsOk = requestForLeaderRotationProof && typeof requestForLeaderRotationProof === 'object' && typeof requestForLeaderRotationProof.skipData === 'object'
    
    overviewIsOk &&= epochHandler.leadersSequence[requestForLeaderRotationProof.shard] // make sure that shard exists

    overviewIsOk &&= currentEpochMetadata.SHARDS_LEADERS_HANDLERS.get(requestForLeaderRotationProof.shard)?.currentLeader > requestForLeaderRotationProof.hisIndexInLeadersSequence // we can't create LRP in case local version of shard leader is bigger/equal to requested


    if(overviewIsOk){

        response.header('access-control-allow-origin','*')
        
        let {index,hash,afp} = requestForLeaderRotationProof.skipData

        let localFinalizationStats = currentEpochMetadata.FINALIZATION_STATS.get(requestForLeaderRotationProof.poolPubKey)



        // We can't sign the reassignment proof in case requested height is lower than our local version of aggregated commitments. So, send 'UPDATE' message
        if(localFinalizationStats && localFinalizationStats.index > index){

            let responseData = {
                
                type:'UPDATE',

                skipData:localFinalizationStats // {index,hash,afp:{prevBlockHash,blockID,blockHash,proofs:{quorumMember0:signa,...,quorumMemberN:signaN}}}

            }

            response.send(responseData)


        }else{

           
            //________________________________________________ Verify the proposed AFP ________________________________________________
            
            
            let afpIsOk = false

            if(index > -1 && typeof afp.blockID === 'string'){

                // eslint-disable-next-line no-unused-vars
                let [_epochID,_blockCreator,indexOfBlockInAfp] = afp.blockID.split(':')

                if(typeof afp === 'object' && afp.blockHash === hash && index == indexOfBlockInAfp){

                    afpIsOk = await verifyAggregatedFinalizationProof(afp,epochHandler)

                }

            } else afpIsOk = true

            
            if(!afpIsOk){

                response.send({err:'Wrong aggregated signature for skipIndex > -1'})

                return

            }


            //_____________________ Verify the AFP for the first block to understand the hash of first block ______________________________

            // We need the hash of first block to fetch it over the network and extract the ASP for previous pool in reassignment chain, take the hash of it and include to final signature
            

            let dataToSignForSkipProof, firstBlockAfpIsOk = false


            /*
            
                We also need the hash of ASP for previous pool

                In case index === -1 it's a signal that no block was created, so no ASPs for previous pool. Sign the nullhash(0123456789ab...)

                Otherwise - find block, compare it's hash with <requestForSkipProof.afpForFirstBlock.prevBlockHash>

                In case hashes match - extract the ASP for previous pool <epochHandler.leadersSequence[shard][indexOfThis-1]>, get the BLAKE3 hash and paste this hash to <dataToSignForSkipProof>
            
                [REMINDER]: Signature structure is ED25519_SIG('LEADER_ROTATION_PROOF:<poolPubKey>:<firstBlockHash>:<index>:<hash>:<epochFullID>')

            */

            if(index === -1){

                // If skipIndex is -1 then sign the hash '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'(null,default hash) as the hash of firstBlockHash
                
                dataToSignForSkipProof = `LEADER_ROTATION_PROOF:${requestForLeaderRotationProof.poolPubKey}:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef:${index}:${'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'}:${epochFullID}`

                firstBlockAfpIsOk = true


            }else if(index >= 0 && typeof requestForLeaderRotationProof.afpForFirstBlock === 'object'){

                // Verify the aggregatedFinalizationProofForFirstBlock in case skipIndex > 0

                let blockIdOfFirstBlock = epochHandler.id+':'+requestForLeaderRotationProof.poolPubKey+':0'
            
                if(await verifyAggregatedFinalizationProof(requestForLeaderRotationProof.afpForFirstBlock,epochHandler) && requestForLeaderRotationProof.afpForFirstBlock.blockID === blockIdOfFirstBlock){

                    let block = await getBlock(epochHandler.id,requestForLeaderRotationProof.poolPubKey,0)

                    if(block && Block.genHash(block) === requestForLeaderRotationProof.afpForFirstBlock.blockHash){

                        let firstBlockHash = requestForLeaderRotationProof.afpForFirstBlock.blockHash

                        dataToSignForSkipProof = `LEADER_ROTATION_PROOF:${requestForLeaderRotationProof.poolPubKey}:${firstBlockHash}:${index}:${hash}:${epochFullID}`

                        firstBlockAfpIsOk = true                    
    
                    }

                }

            }
            
            // If proof is ok - generate reassignment proof

            if(firstBlockAfpIsOk){

                let skipMessage = {
                    
                    type:'OK',

                    sig:await signEd25519(dataToSignForSkipProof,CONFIGURATION.NODE_LEVEL.PRIVATE_KEY)
                }

                response.send(skipMessage)

                
            }else response.send({err:`Wrong signatures in <afpForFirstBlock>`})

             
        }


    }else response.send({err:'Wrong format'})

})




/*

[Info]:

    Accept indexes of leaders on shards by requester version and return required data to define finalization pair for previous leaders (height+hash)

[Accept]:

    {
        shardID:<index of current leader on shard by requester version>
        ...
    }

[Returns]:

   {

        shard_0:{proposedLeaderIndex,firstBlockByCurrentLeader,afpForSecondBlockByCurrentLeader},

        shard_1:{proposedLeaderIndex,firstBlockByCurrentLeader,afpForSecondBlockByCurrentLeader},

        ...

        shard_N:{proposedLeaderIndex,firstBlockByCurrentLeader,afpForSecondBlockByCurrentLeader}

    }

*/

// Function to return aggregated skip proofs for proposed authorities✅

FASTIFY_SERVER.post('/data_to_build_temp_data_for_verification_thread',{bodyLimit:CONFIGURATION.NODE_LEVEL.MAX_PAYLOAD_SIZE},async(request,response)=>{

    let epochHandler = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH

    let epochFullID = epochHandler.hash+"#"+epochHandler.id

    let currentEpochMetadata = EPOCH_METADATA_MAPPING.get(epochFullID)

    if(!currentEpochMetadata){
        
        response.send({err:'Epoch handler on QT is not ready'})

        return
    }


    let proposedIndexesOfLeaders = JSON.parse(request.body) // format {shardID:index}


    if(typeof proposedIndexesOfLeaders === 'object'){

        let objectToReturn = {}

        // Here we should return the ASP for proposed authorities

        // eslint-disable-next-line no-unused-vars
        for(let [shardID, _proposedIndexOfLeader] of Object.entries(proposedIndexesOfLeaders)){

            // Try to get the current leader on shard

            let leaderHandlerForShard = currentEpochMetadata.SHARDS_LEADERS_HANDLERS.get(shardID)

            if(leaderHandlerForShard && epochHandler.leadersSequence[shardID]){

                // Get the index of current leader, first block by it and AFP to prove that this first block was accepted in this epoch

                let currentLeaderPubKeyByMyVersion = epochHandler.leadersSequence[shardID][leaderHandlerForShard.currentLeader]

                let firstBlockID = `${epochHandler.id}:${currentLeaderPubKeyByMyVersion}:0`

                let firstBlockByCurrentLeader = await BLOCKCHAIN_DATABASES.BLOCKS.get(firstBlockID).catch(()=>null)


                if(firstBlockByCurrentLeader){

                    let secondBlockID = `${epochHandler.id}:${currentLeaderPubKeyByMyVersion}:1`

                    let afpForSecondBlockByCurrentLeader = await getVerifiedAggregatedFinalizationProofByBlockId(secondBlockID,epochHandler).catch(()=>null)

                    if(afpForSecondBlockByCurrentLeader){

                        objectToReturn[shardID] = {
                            
                            proposedIndexOfLeader:leaderHandlerForShard.currentLeader,
                            
                            firstBlockByCurrentLeader,
                            
                            afpForSecondBlockByCurrentLeader
                        
                        }

                    }

                }

            }

        }

        response.send(objectToReturn)

    } else response.send({err:'Wrong format'})


})