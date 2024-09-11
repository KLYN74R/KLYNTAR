import {getVerifiedAggregatedFinalizationProofByBlockId, verifyAggregatedEpochFinalizationProof} from '../common_functions/work_with_proofs.js'

import {BLOCKCHAIN_DATABASES, EPOCH_METADATA_MAPPING, NODE_METADATA, WORKING_THREADS} from '../blockchain_preparation.js'

import {getQuorumMajority, getQuorumUrlsAndPubkeys} from '../common_functions/quorum_related.js'

import { getUserAccountFromState } from '../common_functions/state_interactions.js'

import {signEd25519} from '../../../KLY_Utils/utils.js'

import {blockLog} from '../common_functions/logging.js'

import {CONFIGURATION} from '../../../klyn74r.js'

import {getAllKnownPeers} from '../utils.js'

import Block from '../structures/block.js'

import fetch from 'node-fetch'

import Web1337 from 'web1337'




let web1337 = new Web1337({

    chainID:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    workflowVersion:0,
    nodeURL:'http://localhost:7332'
    
});




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



let mockTestPairs = {

    // Ed25519 keypairs

    "9GQ46rqY238rk2neSwgidap9ww5zbAN4dyqyC7j5ZnBK": "MC4CAQAwBQYDK2VwBCIEILdhTMVYFz2GP8+uKUA+1FnZTEdN8eHFzbb8400cpEU9",
    "6XvZpuCDjdvSuot3eLr24C1wqzcf2w4QqeDh9BnDKsNE": "MC4CAQAwBQYDK2VwBCIEIJT7NA/u+Df874H2DFRbyg43LpJwlhcRsS3Bv8/FUIZN",
    "GUbYLN5NqmRocMBHqS183r2FQRoUjhx1p5nKyyUBpntQ": "MC4CAQAwBQYDK2VwBCIEILjvmDeOmyg1/VG2VKQTzsv6lkIizQpjmRsdfEEIHHU8",
    "3JAeBnsMedzxjCMNWQYcAXtwGVE9A5DBQyXgWBujtL9R": "MC4CAQAwBQYDK2VwBCIEIDteWfNev7NOlNmwP8Irwg5miWKoErYGV+UU5VrFgYev",
    "EGU4u3Anwahbtbx8F1ZZgFQSg2u49EkrkqMERT9r3q1o": "MC4CAQAwBQYDK2VwBCIEICVoiHLIICxjcuWQzq1vTLGJmaiU9fAOLEYKB9ZQR8TN",


    // BLS keypairs

    "0xb2ec32c9d7216163790ba3628a6a6b5a12db457c933b1f4627775b6dae468636233c6ad9931a8ef848a58353e60d33dd":"3981d303762bd2016644021e95052c50cb0916470a7eb36205bb12b97913523a",
    "0x8f079049121d5e2ae885bdc6581df9fb68eab94a7aa3ae54bfe1d1ac35aceefbb202f656b0c1b56d64583630612a9970":"53f9079e2bcda99737d1024564ff422a18fcaf931059a3da76646dbbba85874b",
};


let postQuantumBlissKeypair = {

    pubKey: '0012d71baf1524047e13c5006d00cf0cc3123e0ffe00941dda123a1c1806b50d261b660da60414067b13220793131b1d87099d0571175e0884092512c80d4308ab074e090502220c3519001ac10aad1126085e1c270cf815dc10dc04b508931a870b6619e0067e10cf0a7f1c3b04841452174400fc08ed0507040d1d39176b025b06d317e90057145017090e3907201dd50818020e0e74003504400a1a182c14f609f6117902981367191104050add14bd0b031af10c3e02a1160003011a5b137d00c8167b04521c4b1b9016250aeb01b7038d10a818da144406c91bca1b33195e0fd20930193e0dfa11f20f340da50b1215b51d21197c11060de009eb0c8201fb14110be00ec503bd065207a70953132d1a38115b153507da0a3e01290c8016af1d2c18a417100c1508cc112f146a130c013b014704471dbc02c20038013415621985124419ae10a501170eb70e6d0b220ee405ef17ff1c9b0dce0a1f07a204cf1b7b18b9013a0bdc00af187d169e050e0c201b5915c709b011db11170b06159b1cbe03691d860d00028d187d0e61074a1673027a047f16281bac0cfd09a00a62050c07ee1058020e006407de0adc1036136b10b417eb1b12155919b105f60b1d0bde0a57127b0007087d150c11690b7800930f1e16ec19ac0b8d1d7e1b0f02321c90148d1a47075a091113c9159e051113b403b5063001d3186e13b211c70d20',
    privateKey: 'ba17dd98afb6dc1d13e4aed164d318d7921722f54e26496e1bc347213f0bd77230bf2b59676e7c346b155b660067ffb044a01dcc588ac2b6eb196bda8f981a70',
    address: '4218fb0aaace62c4bfafbdd9adb05b99a9bf1a33eeae074215a51cb644b9a85c'

}


let nonces = {};

let generateBatchOfMockTransactionsAndPushToMempool = async shardID => {

    const recipient = 'nXSYHp74u88zKPiRi7t22nv4WCBHXUBpGrVw3V93f2s';

    for(let [pubKey,privateKey] of Object.entries(mockTestPairs)){

        const from = pubKey;

        const myPrivateKey = privateKey;

        let nonce = nonces[pubKey] || await getUserAccountFromState(shardID+':'+pubKey).then(acc=>{

            nonces[pubKey] = acc.nonce

            return acc.nonce

        })


        nonce++

        nonces[pubKey]++


        const fee = 0.03;

        const amountInKLY = 2;

        let signedTx

        if(pubKey.startsWith('0x')){

            let singleSig = web1337.signDataForMultisigTransaction(shardID,privateKey,pubKey,[],nonce,fee,recipient,amountInKLY)

            let signature = singleSig

            signedTx = await web1337.createMultisigTransaction(from,from,signature,[],nonce,fee,recipient,amountInKLY)

        } else {

            signedTx = await web1337.createEd25519Transaction(shardID,from,myPrivateKey,nonce,recipient,fee,amountInKLY);

        }

        console.log(`TXID is => `,web1337.blake3(signedTx.sig))

        NODE_METADATA.MEMPOOL.push(signedTx)
    }

    // Also, for tests, create tx with PQC account

    const from = postQuantumBlissKeypair.address;

    const myPrivateKey = postQuantumBlissKeypair.privateKey;

    let nonce = nonces[from] || await getUserAccountFromState(shardID+':'+from).then(acc=>{

        nonces[from] = acc.nonce

        return acc.nonce

    })


    nonce++

    nonces[from]++

    const fee = 0.03;

    const amountInKLY = 2;

    let signedPqcTx = await web1337.createPostQuantumTransaction(shardID,'bliss',from,myPrivateKey,nonce,recipient,amountInKLY,fee)

    console.log(`PQC TXID is => `,web1337.blake3(signedPqcTx.sig))

    NODE_METADATA.MEMPOOL.push(signedPqcTx)

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

    if(!currentEpochMetadata) return


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

        let lrpsSignaturesForPreviousLeader = currentEpochMetadata.TEMP_CACHE.get(`LRPS:${pubKeyOfOneOfPreviousLeader}`).proofs

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

            if(lrpsSignaturesForPreviousLeader[pubKeyOfQuorumMember]) continue

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

    if(proofsGrabber && WORKING_THREADS.GENERATION_THREAD.epochFullId === epochFullID && WORKING_THREADS.GENERATION_THREAD.nextIndex > proofsGrabber.acceptedIndex+1) return

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

        generateBatchOfMockTransactionsAndPushToMempool(myShardForThisEpoch)

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