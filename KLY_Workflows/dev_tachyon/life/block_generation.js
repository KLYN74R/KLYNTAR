import {getVerifiedAggregatedFinalizationProofByBlockId, verifyAggregatedEpochFinalizationProof} from '../common_functions/work_with_proofs.js'

import {BLOCKCHAIN_DATABASES, EPOCH_METADATA_MAPPING, NODE_METADATA, WORKING_THREADS} from '../blockchain_preparation.js'

import {getQuorumMajority, getQuorumUrlsAndPubkeys} from '../common_functions/quorum_related.js'

import {signEd25519} from '../../../KLY_Utils/utils.js'

import {blockLog} from '../common_functions/logging.js'

import {CONFIGURATION} from '../../../klyn74r.js'

import {getAllKnownPeers} from '../utils.js'

import Block from '../structures/block.js'

import fetch from 'node-fetch'





export let blocksGenerationProcess=async()=>{

    await generateBlocksPortion()

    setTimeout(blocksGenerationProcess,WORKING_THREADS.APPROVEMENT_THREAD.NETWORK_PARAMETERS.BLOCK_TIME)
 
}




let getTransactionsFromMempool = () => NODE_METADATA.MEMPOOL.splice(0,WORKING_THREADS.APPROVEMENT_THREAD.NETWORK_PARAMETERS.TXS_LIMIT_PER_BLOCK)

let getEpochEdgeTransactionsFromMempool = epochFullID => {

    if(!EPOCH_METADATA_MAPPING.has(epochFullID)) return []

    let epochEdgeTransactionsMempool = EPOCH_METADATA_MAPPING.get(epochFullID).EPOCH_EDGE_TRANSACTIONS_MEMPOOL

    return epochEdgeTransactionsMempool.splice(0,WORKING_THREADS.APPROVEMENT_THREAD.NETWORK_PARAMETERS.EPOCH_EDGE_TRANSACTIONS_LIMIT_PER_BLOCK)

}




/*

Function to find the AGGREGATED_EPOCH_FINALIZATION_PROOFS for appropriate shard

Ask the network in special order:

    1) Special configured URL (it might be plugin's API)
    2) Quorum members
    3) Other known peers

*/
let getAggregatedEpochFinalizationProofForPreviousEpoch = async shardID => {


    let allKnownNodes = [CONFIGURATION.NODE_LEVEL.GET_PREVIOUS_EPOCH_AGGREGATED_FINALIZATION_PROOF_URL,...await getQuorumUrlsAndPubkeys(),...getAllKnownPeers()]


    // First of all - try to find it locally

    let aefpProof = await BLOCKCHAIN_DATABASES.EPOCH_DATA.get(`AEFP:${WORKING_THREADS.GENERATION_THREAD.epochIndex}:${shardID}`).catch(()=>null)

    if(aefpProof) return aefpProof

    else {

        for(let nodeEndpoint of allKnownNodes){

            let finalURL = `${nodeEndpoint}/aggregated_epoch_finalization_proof/${WORKING_THREADS.GENERATION_THREAD.epochIndex}/${shardID}`
    
            let itsProbablyAggregatedEpochFinalizationProof = await fetch(finalURL).then(r=>r.json()).catch(()=>false)
    
            let aefpProof = itsProbablyAggregatedEpochFinalizationProof?.shard === shardID && await verifyAggregatedEpochFinalizationProof(
                
                itsProbablyAggregatedEpochFinalizationProof,
    
                WORKING_THREADS.GENERATION_THREAD.quorum,
    
                WORKING_THREADS.GENERATION_THREAD.majority,        
    
                WORKING_THREADS.GENERATION_THREAD.epochFullId
            
            )
    
            if(aefpProof) return aefpProof
    
        }    

    }
    
}





let getAggregatedLeaderRotationProof = async (epochHandler,pubKeyOfOneOfPreviousLeader,hisIndexInLeadersSequence,shardID) => {

    /*
        This function is used once you become shard leader and you need to get the ALRPs for all the previous leaders
        on this shard till the pool which was reassigned on non-zero height
    */

    let epochFullID = epochHandler.hash+"#"+epochHandler.id

    let currentEpochMetadata = EPOCH_METADATA_MAPPING.get(epochFullID)

    if(!currentEpochMetadata){

        return

    }


    // Try to return immediately
    
    let aggregatedLeaderRotationProofs = currentEpochMetadata.TEMP_CACHE.get(`LRPS:${pubKeyOfOneOfPreviousLeader}`)

    let quorumMajority = getQuorumMajority(epochHandler)

    if(aggregatedLeaderRotationProofs && Object.keys(aggregatedLeaderRotationProofs.proofs).length >= quorumMajority){

        return aggregatedLeaderRotationProofs

    }


    // Prepare the template that we're going to send to quorum to get the ALRP
    
    let firstBlockIDByThisLeader = epochHandler.id+':'+pubKeyOfOneOfPreviousLeader+':0' // epochID:PubKeyOfCreator:0 - first block in epoch

    let afpForFirstBlock = await getVerifiedAggregatedFinalizationProofByBlockId(firstBlockIDByThisLeader,epochHandler)

    let firstBlockHash

    let localFinalizationStatsForThisPool = currentEpochMetadata.FINALIZATION_STATS.get(pubKeyOfOneOfPreviousLeader) || {index:-1,hash:'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',afp:{}}


    if(localFinalizationStatsForThisPool.index === -1){

        localFinalizationStatsForThisPool.hash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

        afpForFirstBlock = null

    }


    // Set the hash of first block for pool
    // In case previous leader created zero blocks - set the <firstBlockHash> to "null-hash-value"('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef')
    // Otherwise, if at least one block was created & shared among quorum - take the hash value from AFP (.blockHash field(see AFP structure))
    
    if(!afpForFirstBlock && localFinalizationStatsForThisPool.index === -1) firstBlockHash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

    else if(afpForFirstBlock) firstBlockHash = afpForFirstBlock.blockHash

    else return


    // In case we haven't define hash of first block - stop searching process. Try next time

    if(firstBlockHash){

        // Create the cache to store LRPs for appropriate previous leader

        if(!currentEpochMetadata.TEMP_CACHE.has(`LRPS:${pubKeyOfOneOfPreviousLeader}`)){

            let templateToStore = {

                firstBlockHash,

                skipIndex:localFinalizationStatsForThisPool.index,

                skipHash:localFinalizationStatsForThisPool.hash,

                proofs:{} // quorumMemberPubkey => SIG(`LEADER_ROTATION_PROOF:${pubKeyOfOneOfPreviousLeader}:${firstBlockHash}:${skipIndex}:${skipHash}:${epochFullID}`)

            }

            currentEpochMetadata.TEMP_CACHE.set(`LRPS:${pubKeyOfOneOfPreviousLeader}`,templateToStore)
    
        }

        let lrpsCacheForLeader = currentEpochMetadata.TEMP_CACHE.get(`LRPS:${pubKeyOfOneOfPreviousLeader}`).proofs

        let messageToSend = JSON.stringify({

            route:'get_leader_rotation_proof',
     
            poolPubKey:pubKeyOfOneOfPreviousLeader,

            hisIndexInLeadersSequence,

            shard:shardID,

            afpForFirstBlock,

            skipData:localFinalizationStatsForThisPool
    
        })


        for(let pubKeyOfQuorumMember of epochHandler.quorum){
    
            // No sense to get finalization proof again if we already have

            if(lrpsCacheForLeader[pubKeyOfQuorumMember]) continue

            let connection = currentEpochMetadata.TEMP_CACHE.get('WS:'+pubKeyOfQuorumMember)

            if(connection) connection.sendUTF(messageToSend)

        }

        await new Promise(resolve=>

            setTimeout(()=>resolve(),1000)
    
        )

    }

}




let generateBlocksPortion = async() => {

    let epochHandler = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH
    
    let epochFullID = epochHandler.hash+"#"+epochHandler.id

    let epochIndex = epochHandler.id

    let currentEpochMetadata = EPOCH_METADATA_MAPPING.get(epochFullID)


    if(!currentEpochMetadata) return


    //_________________ No sense to generate blocks more in case we haven't approved the previous ones _________________

    let proofsGrabber = currentEpochMetadata.TEMP_CACHE.get('PROOFS_GRABBER')

    if(proofsGrabber && WORKING_THREADS.GENERATION_THREAD.nextIndex > proofsGrabber.acceptedIndex+1) return

    //_________________ Once we moved to new epoch - check the shard where this validator was assigned _________________

    if(!currentEpochMetadata.TEMP_CACHE.has('MY_SHARD_FOR_THIS_EPOCH')){

        for(let [shardID, poolsForShardOnThisEpoch] of Object.entries(epochHandler.leadersSequence)){

            if(poolsForShardOnThisEpoch.includes(CONFIGURATION.NODE_LEVEL.PUBLIC_KEY)){

                currentEpochMetadata.TEMP_CACHE.set('MY_SHARD_FOR_THIS_EPOCH',shardID)

            }

        }

    }

    // Safe "if" branch to prevent unnecessary blocks generation

    // Must be string value

    let canGenerateBlocksNow = currentEpochMetadata.SHARDS_LEADERS_HANDLERS.get(CONFIGURATION.NODE_LEVEL.PUBLIC_KEY)

    let myShardForThisEpoch = currentEpochMetadata.TEMP_CACHE.get('MY_SHARD_FOR_THIS_EPOCH')


    if(typeof canGenerateBlocksNow === 'string'){

        // Check if <epochFullID> is the same in APPROVEMENT_THREAD and in GENERATION_THREAD

        if(WORKING_THREADS.GENERATION_THREAD.epochFullId !== epochFullID){

            // If new epoch - add the aggregated proof of previous epoch finalization

            if(epochIndex !== 0){

                let aefpForPreviousEpoch = await getAggregatedEpochFinalizationProofForPreviousEpoch(myShardForThisEpoch)

                // If we can't find a proof - try to do it later
                // Only in case it's initial epoch(index is -1) - no sense to push it
                if(!aefpForPreviousEpoch) return

                WORKING_THREADS.GENERATION_THREAD.aefpForPreviousEpoch = aefpForPreviousEpoch

            }

            // Update the index & hash of epoch

            WORKING_THREADS.GENERATION_THREAD.epochFullId = epochFullID

            WORKING_THREADS.GENERATION_THREAD.epochIndex = epochIndex

            // Recount new values

            WORKING_THREADS.GENERATION_THREAD.quorum = epochHandler.quorum

            WORKING_THREADS.GENERATION_THREAD.majority = getQuorumMajority(epochHandler)


            // And nullish the index & hash in generation thread for new epoch

            WORKING_THREADS.GENERATION_THREAD.prevHash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
 
            WORKING_THREADS.GENERATION_THREAD.nextIndex = 0
    
        }

        let extraData = {}

        //___________________ Add the AEFP to the first block of epoch ___________________

        if(WORKING_THREADS.GENERATION_THREAD.epochIndex > 0 && WORKING_THREADS.GENERATION_THREAD.nextIndex === 0){

            // Add the AEFP for previous epoch

            extraData.aefpForPreviousEpoch = WORKING_THREADS.GENERATION_THREAD.aefpForPreviousEpoch

            if(!extraData.aefpForPreviousEpoch) return


        }

        // Do it only for the first block in epoch(with index 0)

        if(WORKING_THREADS.GENERATION_THREAD.nextIndex === 0){

            // Build the template to insert to the extraData of block. Structure is {pool0:ALRP,...,poolN:ALRP}

            let leadersSequenceOfMyShard = epochHandler.leadersSequence[myShardForThisEpoch]
    
            let myIndexInLeadersSequenceForShard = leadersSequenceOfMyShard.indexOf(CONFIGURATION.NODE_LEVEL.PUBLIC_KEY)
    

            // Get all previous pools - from zero to <my_position>

            let pubKeysOfAllThePreviousPools = leadersSequenceOfMyShard.slice(0,myIndexInLeadersSequenceForShard).reverse()



            //_____________________ Fill the extraData.aggregatedLeadersRotationProofs _____________________


            extraData.aggregatedLeadersRotationProofs = {}

            /*

                Here we need to fill the object with aggregated leader rotation proofs (ALRPs) for all the previous pools till the pool which was rotated on not-zero height
            
                If we can't find all the required ALRPs - skip this iteration to try again later

            */

            // Add the ALRP for the previous pools in leaders sequence

            let indexOfPreviousLeaderInSequence = myIndexInLeadersSequenceForShard-1

            for(let pubKeyOfPreviousLeader of pubKeysOfAllThePreviousPools){

                let aggregatedLeaderRotationProof = await getAggregatedLeaderRotationProof(epochHandler,pubKeyOfPreviousLeader,indexOfPreviousLeaderInSequence,myShardForThisEpoch).catch(()=>null)

                if(aggregatedLeaderRotationProof){

                    extraData.aggregatedLeadersRotationProofs[pubKeyOfPreviousLeader] = aggregatedLeaderRotationProof

                    if(aggregatedLeaderRotationProof.skipIndex >= 0) break // if we hit the ALRP with non-null index(at least index >= 0) it's a 100% that sequence is not broken, so no sense to push ALRPs for previous pools 

                    indexOfPreviousLeaderInSequence--

                } else return

            }

        }

        /*

        _________________________________________GENERATE PORTION OF BLOCKS___________________________________________
    
        Here we check how many transactions(events) we have locally and generate as many blocks as it's possible
    
        */

        let numberOfBlocksToGenerate = Math.ceil(NODE_METADATA.MEMPOOL.length / WORKING_THREADS.APPROVEMENT_THREAD.NETWORK_PARAMETERS.TXS_LIMIT_PER_BLOCK)


        //_______________________________________FILL THE BLOCK WITH EXTRA DATA_________________________________________

        // 0.Add the epoch edge transactions to block extra data

        extraData.epochEdgeTransactions = getEpochEdgeTransactionsFromMempool(WORKING_THREADS.GENERATION_THREAD.epochFullId)

        // 1.Add the extra data to block from configs(it might be your note, for instance)

        extraData.rest = {...CONFIGURATION.NODE_LEVEL.EXTRA_DATA_TO_BLOCK}


        if(numberOfBlocksToGenerate===0) numberOfBlocksToGenerate++

        let atomicBatch = BLOCKCHAIN_DATABASES.BLOCKS.batch()

        for(let i=0;i<numberOfBlocksToGenerate;i++){


            let blockCandidate = new Block(getTransactionsFromMempool(),extraData,WORKING_THREADS.GENERATION_THREAD.epochFullId)
                            
            let hash = Block.genHash(blockCandidate)
    
    
            blockCandidate.sig = await signEd25519(hash,CONFIGURATION.NODE_LEVEL.PRIVATE_KEY)
                
            blockLog(`New block generated`,hash,blockCandidate,WORKING_THREADS.GENERATION_THREAD.epochIndex)
    
    
            WORKING_THREADS.GENERATION_THREAD.prevHash = hash
     
            WORKING_THREADS.GENERATION_THREAD.nextIndex++
        
            // BlockID has the following format => epochID(epochIndex):Ed25519_Pubkey:IndexOfBlockInCurrentEpoch
            let blockID = WORKING_THREADS.GENERATION_THREAD.epochIndex+':'+CONFIGURATION.NODE_LEVEL.PUBLIC_KEY+':'+blockCandidate.index
    
            // Store block locally
            atomicBatch.put(blockID,blockCandidate)
               
        }
    
        // Update the GENERATION_THREAD after all
        atomicBatch.put('GT',WORKING_THREADS.GENERATION_THREAD)
    
        await atomicBatch.write()
    
    }

}