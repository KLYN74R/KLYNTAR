import {CHECK_AGGREGATED_SKIP_PROOF_VALIDITY,GET_BLOCK,VERIFY_AGGREGATED_FINALIZATION_PROOF} from "../../verification.js"

import {BLAKE3,BODY,ED25519_SIGN_DATA} from "../../../../KLY_Utils/utils.js"

import Block from "../../essences/block.js"







/*


[Info]:

    Function to return signature of reassignment proof if we have SKIP_HANDLER for requested shard
    
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
        sig: ED25519_SIG('SKIP:<poolPubKey>:<previousAspHash>:<firstBlockHash>:<index>:<hash>:<epochFullID>')
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
let getReassignmentProof=response=>response.writeHeader('Access-Control-Allow-Origin','*').onAborted(()=>response.aborted=true).onData(async bytes=>{

    let epochHandler = global.SYMBIOTE_META.QUORUM_THREAD.EPOCH

    let epochFullID = epochHandler.hash+"#"+epochHandler.id

    let tempObject = global.SYMBIOTE_META.TEMP.get(epochFullID)

    if(!tempObject){

        !response.aborted && response.end(JSON.stringify({err:'Epoch handler on QT is not ready'}))

        return
    }


    let mySkipHandlers = tempObject.SKIP_HANDLERS

    let requestForSkipProof = await BODY(bytes,global.CONFIG.MAX_PAYLOAD_SIZE)

    let overviewIsOk = typeof requestForSkipProof === 'object' && epochHandler.reassignmentChains[requestForSkipProof.shard] && mySkipHandlers.has(requestForSkipProof.poolPubKey)
    
                       &&
                       
                       typeof requestForSkipProof.skipData === 'object' && (requestForSkipProof.skipData.index === -1  || typeof requestForSkipProof.skipData.afp === 'object')


    if(overviewIsOk){

        
        
        let {index,hash,afp} = requestForSkipProof.skipData

        let localSkipHandler = mySkipHandlers.get(requestForSkipProof.poolPubKey)



        // We can't sign the reassignment proof in case requested height is lower than our local version of aggregated commitments. So, send 'UPDATE' message
        if(localSkipHandler.skipData && localSkipHandler.skipData.index > index){

            let responseData = {
                
                type:'UPDATE',

                skipData:localSkipHandler.skipData // {index,hash,afp:{prevBlockHash,blockID,blockHash,proofs:{quorumMember0:signa,...,quorumMemberN:signaN}}}

            }

            !response.aborted && response.end(JSON.stringify(responseData))


        }else{

           
            //________________________________________________ Verify the proposed AFP ________________________________________________
            
            // For speed we started to use Ed25519 instead of BLS again
            
            let afpInSkipDataIsOk = false

            if(index > -1 && typeof afp.blockID === 'string'){

                let [_epochID,_blockCreator,indexOfBlockInAfp] = afp.blockID.split(':')

                if(typeof afp === 'object' && afp.blockHash === hash && index == indexOfBlockInAfp){

                    afpInSkipDataIsOk = await VERIFY_AGGREGATED_FINALIZATION_PROOF(afp,epochHandler)

                }

            }else afpInSkipDataIsOk = true

            
            if(!afpInSkipDataIsOk){

                !response.aborted && response.end(JSON.stringify({err:'Wrong aggregated signature for skipIndex > -1'}))

                return

            }


            //_____________________ Verify the AFP for the first block to understand the hash of first block ______________________________

            // We need the hash of first block to fetch it over the network and extract the ASP for previous pool in reassignment chain, take the hash of it and include to final signature
            

            let dataToSignForSkipProof, firstBlockAfpIsOk = false


            /*
            
                We also need the hash of ASP for previous pool

                In case index === -1 it's a signal that no block was created, so no ASPs for previous pool. Sign the nullhash(0123456789ab...)

                Otherwise - find block, compare it's hash with <requestForSkipProof.afpForFirstBlock.prevBlockHash>

                In case hashes match - extract the ASP for previous pool <epochHandler.reassignmentChains[shard][indexOfThis-1]>, get the BLAKE3 hash and paste this hash to <dataToSignForSkipProof>
            
                [REMINDER]: Signature structure is ED25519_SIG('SKIP:<poolPubKey>:<previousAspHash>:<firstBlockHash>:<index>:<hash>:<epochFullID>')

            */

            let indexInReassignmentChainForRequestedPool = epochHandler.reassignmentChains[requestForSkipProof.shard].indexOf(requestForSkipProof.poolPubKey)

            // In case indexInReassignmentChainForRequestedPool === -1 - this means that previousPoolPubKey will be equal to prime pool pubkey(===shardID)
            let previousPoolPubKey = epochHandler.reassignmentChains[requestForSkipProof.shard][indexInReassignmentChainForRequestedPool-1] || requestForSkipProof.shard


            if(index === -1){

                // If skipIndex is -1 then sign the hash '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'(null,default hash) as the hash of firstBlockHash
                
                dataToSignForSkipProof = `SKIP:${requestForSkipProof.poolPubKey}:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef:${index}:${'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'}:${epochFullID}`

                firstBlockAfpIsOk = true


            }else if(index > 0 && typeof requestForSkipProof.afpForFirstBlock === 'object'){

                // Verify the aggregatedFinalizationProofForFirstBlock in case skipIndex > 0

                let blockIdOfFirstBlock = epochHandler.id+':'+requestForSkipProof.poolPubKey+':0'
            
                if(await VERIFY_AGGREGATED_FINALIZATION_PROOF(requestForSkipProof.afpForFirstBlock,epochHandler) && requestForSkipProof.afpForFirstBlock.blockID === blockIdOfFirstBlock){

                    let block = await GET_BLOCK(epochHandler.id,requestForSkipProof.poolPubKey,0)

                    if(block && Block.genHash(block) === requestForSkipProof.afpForFirstBlock.blockHash){

                        // In case it's prime pool - it has the first position in own reassignment chain. That's why, the hash of ASP for previous pool will be null(0123456789ab...)

                        let hashOfAspForPreviousPool = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

                        if(block.extraData.reassignments){

                            hashOfAspForPreviousPool = BLAKE3(JSON.stringify(block.extraData.reassignments[previousPoolPubKey]))

                        }

                        let firstBlockHash = requestForSkipProof.afpForFirstBlock.blockHash

                        dataToSignForSkipProof = `SKIP:${requestForSkipProof.poolPubKey}:${hashOfAspForPreviousPool}:${firstBlockHash}:${index}:${hash}:${epochFullID}`

                        firstBlockAfpIsOk = true                    
    
                    }

                }

            }
            
            // If proof is ok - generate reassignment proof

            if(firstBlockAfpIsOk){

                let skipMessage = {
                    
                    type:'OK',

                    sig:await ED25519_SIGN_DATA(dataToSignForSkipProof,global.PRIVATE_KEY)
                }

                !response.aborted && response.end(JSON.stringify(skipMessage))

                
            }else !response.aborted && response.end(JSON.stringify({err:`Wrong signatures in <afpForFirstBlock>`}))

             
        }


    }else !response.aborted && response.end(JSON.stringify({err:'Wrong format'}))


})



/*

[Info]:

    Accept indexes of authorities on shards by requester version and return ASPs for them

[Accept]:

    {
        primePoolPubKey:<index of current leader on shard by requester version>
        ...
    }

[Returns]:

    {
        primePoolPubKey(shardID):<aggregatedSkipProofForProposedLeader>
        ...
    
    }

*/
let aggregatedSkipProofsForProposedAuthorities=response=>response.writeHeader('Access-Control-Allow-Origin','*').onAborted(()=>response.aborted=true).onData(async bytes=>{

    let epochHandler = global.SYMBIOTE_META.QUORUM_THREAD.EPOCH

    let epochFullID = epochHandler.hash+"#"+epochHandler.id

    let tempObject = global.SYMBIOTE_META.TEMP.get(epochFullID)

    if(!tempObject){

        !response.aborted && response.end(JSON.stringify({err:'Epoch handler on QT is not ready'}))

        return
    }


    let proposedIndexesOfAuthorities = await BODY(bytes,global.CONFIG.MAX_PAYLOAD_SIZE) // format {primePoolPubKey:index}


    if(typeof proposedIndexesOfAuthorities === 'object'){

        let objectToReturn = {}

        // Here we should return the ASP for proposed authorities

        for(let [shardID, proposedIndexOfLeader] of Object.entries(proposedIndexesOfAuthorities)){

            if(epochHandler.reassignmentChains[shardID]){

                let pubKeyOfPoolByThisIndex = epochHandler.reassignmentChains[shardID][proposedIndexOfLeader] || shardID

                let aggregatedSkipProofForThisPool = tempObject.SKIP_HANDLERS.get(pubKeyOfPoolByThisIndex)?.aggregatedSkipProof

                objectToReturn[shardID] = aggregatedSkipProofForThisPool

            }


        }

        !response.aborted && response.end(JSON.stringify(objectToReturn))

    } else !response.aborted && response.end(JSON.stringify({err:'Wrong format'}))


})




/*


[Info]:

    Handler to accept ASP and start the instant reassignment procedure

[Accept]:


    {
        shard:<shard ID - pubkey of prime pool>,

        shouldBeThisLeader:<number>

        aspsForPreviousPools:{

            "poolPubKeyX":{

                previousAspHash,

                firstBlockHash,

                skipIndex,

                skipHash,

                proofs:{

                    quorumMemberPubKey0:hisEd25519Signa,
                    ...
                    quorumMemberPubKeyN:hisEd25519Signa

                }

            },


            "poolPubKeY":{

                previousAspHash,

                firstBlockHash,

                skipIndex,

                skipHash,

                proofs:{

                    quorumMemberPubKey0:hisEd25519Signa,
                    ...
                    quorumMemberPubKeyN:hisEd25519Signa

                }

            },

            ... (we need to send ASPs for all the pools from index <shouldBeThisLeader-1> until the beginning of reassignment chain. We can stop when .skipIndex of some ASP won't be -1)


        }

    }

    _________________________ What to do next _________________________

    1) Get the local reassignment data for proposed shard => localReassignmentData = tempObject.REASSIGNMENTS.get(shard)

    2) In case localReassignmentData.currentLeader < obj[<shard>].shouldBeThisLeader => verify the ASPs
    
    3) In case all the ASPs are ok - create the CREATE_REASSIGNMENT request and push it to tempObject.SYNCHRONIZER to update the local info about reassignment

    4) Inside function REASSIGN_PROCEDURE_MONITORING check the requests and update the local reassignment data


*/
let acceptReassignment=response=>response.writeHeader('Access-Control-Allow-Origin','*').onAborted(()=>response.aborted=true).onData(async bytes=>{

    let epochHandler = global.SYMBIOTE_META.QUORUM_THREAD.EPOCH

    let epochFullID = epochHandler.hash+"#"+epochHandler.id

    let tempObject = global.SYMBIOTE_META.TEMP.get(epochFullID)

    if(!tempObject){

        !response.aborted && response.end(JSON.stringify({err:'Epoch handler on QT is not ready'}))

        return
    }


    let possibleReassignmentPropositionForShard = await BODY(bytes,global.CONFIG.MAX_PAYLOAD_SIZE)


    if(typeof possibleReassignmentPropositionForShard === 'object'){


        // Parse reassignment proposition
        let {shard,shouldBeThisLeader,aspsForPreviousPools} = possibleReassignmentPropositionForShard


        if(typeof shard !== 'string' || !epochHandler.poolsRegistry.primePools.includes(shard) || typeof shouldBeThisLeader !== 'number' || typeof aspsForPreviousPools !== 'object'){

            !response.aborted && response.end(JSON.stringify({err:'Wrong format of proposition components or no such shard'}))

            return

        }

        let localRcHandlerForShard = tempObject.REASSIGNMENTS.get(shard) || {currentLeader:-1}

        // Compare the .currentLeader indexes to make sure that proposed leader has the bigger index 

        if(localRcHandlerForShard.currentLeader < shouldBeThisLeader){

            // Verify the ASP for pool with index <shouldBeThisLeader-1> in reassignment chain
            // If ok - create the CREATE_REASSIGNMENT:<shard> request and push to synchronizer
            // Due to Node.js work principles - check the indexes right before push

            let pubKeyOfSkippedPool = epochHandler.reassignmentChains[shard][shouldBeThisLeader-1] || shard

            let aspForSkippedPool = aspsForPreviousPools[pubKeyOfSkippedPool]

            let aspIsOk = await CHECK_AGGREGATED_SKIP_PROOF_VALIDITY(pubKeyOfSkippedPool,aspForSkippedPool,epochFullID,epochHandler)
            
            if(aspIsOk) {

                let indexInReassignmentChain = shouldBeThisLeader-2 // -2 because we checked -1 position

                while(indexInReassignmentChain >= -1){

                    let currentPoolToVerify = epochHandler.reassignmentChains[shard][indexInReassignmentChain] || shard

                    let nextPoolInRC = epochHandler.reassignmentChains[shard][indexInReassignmentChain+1]

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
                    
                    Node.js will read the data from mapping, compare .shouldBeThisLeader property and add new request in case index is bigger - and all these ops in sync mode
                
                */
                
                let concurrentRequest = tempObject.SYNCHRONIZER.get('CREATE_REASSIGNMENT:'+shard)


                if(!concurrentRequest || concurrentRequest && concurrentRequest.shouldBeThisLeader < shouldBeThisLeader){

                    tempObject.SYNCHRONIZER.set('CREATE_REASSIGNMENT:'+shard,{shouldBeThisLeader:shouldBeThisLeader,aspsForPreviousPools})

                }

                !response.aborted && response.end(JSON.stringify({status:'OK'}))

            } else !response.aborted && response.end(JSON.stringify({err:'One of ASP is wrong'}))

        } else !response.aborted && response.end(JSON.stringify({err:'Local index of current shard leader is bigger'}))

    }else !response.aborted && response.end(JSON.stringify({err:'Wrong format'}))


})






global.UWS_SERVER


// Function to return signature of reassignment proof if we have SKIP_HANDLER for requested pool. Return the signature if requested INDEX >= than our own or send UPDATE message with AGGREGATED_COMMITMENTS ✅
.post('/reassignment_proof',getReassignmentProof)

// Function to return aggregated skip proofs for proposed authorities
.post('/aggregated_skip_proofs_for_proposed_authorities',aggregatedSkipProofsForProposedAuthorities)

// Handler to accept ASPs and to start forced reassignment
.post('/accept_reassignment',acceptReassignment)