/* eslint-disable no-unused-vars */

import { BLOCKCHAIN_DATABASES, GLOBAL_CACHES, WORKING_THREADS } from "../../blockchain_preparation.js"

import { getFromApprovementThreadState } from "../../common_functions/approvement_thread_related.js"

import { getFromState, getUserAccountFromState } from "../../common_functions/state_interactions.js"




export let CONTRACT_FOR_DELAYED_TRANSACTIONS = {


    /*
    

    delayedTransaction is:

    {
        type:'createStakingPool',
        
        creator: transaction.creator,

        originShard, percentage, overStake, poolURL, wssPoolURL
    }
    
    */
    createStakingPool:async (threadContext,delayedTransaction) => {

        let {creator,originShard,percentage,overStake,poolURL,wssPoolURL} = delayedTransaction

        let poolAlreadyExists = await BLOCKCHAIN_DATABASES.APPROVEMENT_THREAD_METADATA.get(creator+'(POOL)_STORAGE_POOL').catch(()=>null)

        if(!poolAlreadyExists && overStake>=0 && percentage >=0 && typeof originShard === 'string' && typeof poolURL === 'string' && typeof wssPoolURL === 'string'){

            let contractMetadataTemplate = {

                type:'contract',
                lang:'system/staking/sub',
                balance:0,
                gas:0,
                storages:['POOL'],
                storageAbstractionLastPayment:0

            }

            let onlyOnePossibleStorageForStakingContract = {
                
                percentage,

                overStake,

                totalStakedKly:55000,

                totalStakedUno: 0,

                shard: originShard,

                stakers:{}, // Pubkey => {kly,uno,reward}

                poolURL,

                wssPoolURL

            }

            // Add the pool creator to stakers, but with zero amount of assets => {kly:0,uno:0,reward:0}
            // We need it to send rewards to this special address

            onlyOnePossibleStorageForStakingContract.stakers[creator] = {kly:0,uno:0,reward:0}

            if(threadContext === 'APPROVEMENT_THREAD'){

                // Put storage
                // NOTE: We just need a simple storage with ID="POOL"
                
                GLOBAL_CACHES.APPROVEMENT_THREAD_CACHE.set(creator+'(POOL)_STORAGE_POOL',onlyOnePossibleStorageForStakingContract)

            } else {

                GLOBAL_CACHES.STATE_CACHE.set(creator+'(POOL)_POINTER',originShard)

                // Put storage
                // NOTE: We just need a simple storage with ID="POOL"
                GLOBAL_CACHES.STATE_CACHE.set(originShard+':'+creator+'(POOL)_STORAGE_POOL',onlyOnePossibleStorageForStakingContract)

                // Put metadata
                GLOBAL_CACHES.STATE_CACHE.set(originShard+':'+creator+'(POOL)',contractMetadataTemplate)

            }

            return {isOk:true}

        } else return {isOk:false}

    },


    /*
    
    delayedTransaction is:

    {
        type:'stake',

        staker: transaction.creator,

        poolPubKey,amount
    }
    
    */
    stake:async(threadContext,delayedTransaction) => {

        let {staker,poolPubKey,amount} = delayedTransaction

        let poolStorage

        let shardWherePoolStorageLocated

        if(threadContext === 'APPROVEMENT_THREAD'){

            poolStorage = await getFromApprovementThreadState(poolPubKey+'(POOL)_STORAGE_POOL')

        } else {
        
            shardWherePoolStorageLocated = await getFromState(poolPubKey+'(POOL)_POINTER').catch(()=>null)

            poolStorage = await getFromState(shardWherePoolStorageLocated+':'+poolPubKey+'(POOL)_STORAGE_POOL').catch(()=>null)

        }

        let threadById = threadContext === 'APPROVEMENT_THREAD' ? WORKING_THREADS.APPROVEMENT_THREAD : WORKING_THREADS.VERIFICATION_THREAD

        let toReturn

        if(poolStorage){

            let amountIsBiggerThanMinimalStake = amount >= threadById.NETWORK_PARAMETERS.MINIMAL_STAKE_PER_ENTITY

            let noOverstake = poolStorage.totalStakedKly + poolStorage.overStake >= poolStorage.totalStakedKly + amount

            // Here we also need to check if pool is still not fullfilled

            if(amountIsBiggerThanMinimalStake && noOverstake){

                if(!poolStorage.stakers[staker]) poolStorage.stakers[staker] = {kly:0, uno:0, reward:0}

                poolStorage.stakers[staker].kly += amount

                poolStorage.totalStakedKly += amount

                // Check if pool has enough power to be added to pools registry

                if(poolStorage.totalStakedKly >= threadById.NETWORK_PARAMETERS.VALIDATOR_STAKE && !threadById.EPOCH.poolsRegistry.includes(poolPubKey)){

                    threadById.EPOCH.poolsRegistry.push(poolPubKey)

                }

                toReturn = {isOk:true}

            } else toReturn = {isOk:false,reason:'Overview failed'}

        } else toReturn = {isOk:false,reason:'No such pool'}


        if(!toReturn.isOk && shardWherePoolStorageLocated){

            // Return the stake 

            let txCreatorAccount = await getUserAccountFromState(shardWherePoolStorageLocated+':'+staker)

            if(txCreatorAccount){

                amount = Number(amount.toFixed(9))
    
                txCreatorAccount.balance += amount

                txCreatorAccount.balance -= 0.000000001

            }

        }

        return toReturn

    },


    /*
    
    delayedTransaction is:

    {
        type:'unstake',

        unstaker: transaction.creator,

        poolPubKey,amount
    }
    
    */
    unstake:async (threadContext,delayedTransaction) => {

        let {unstaker,poolPubKey,amount} = delayedTransaction

        let poolStorage

        let shardWherePoolStorageLocated


        if(threadContext === 'APPROVEMENT_THREAD'){

            poolStorage = await getFromApprovementThreadState(poolPubKey+'(POOL)_STORAGE_POOL')

        } else {
        
            shardWherePoolStorageLocated = await getFromState(poolPubKey+'(POOL)_POINTER').catch(()=>null)

            poolStorage = await getFromState(shardWherePoolStorageLocated+':'+poolPubKey+'(POOL)_STORAGE_POOL').catch(()=>null)

        }

        if(poolStorage){

            let unstakerAccount = poolStorage.stakers[unstaker]

            if(unstakerAccount){

                let threadById = threadContext === 'APPROVEMENT_THREAD' ? WORKING_THREADS.APPROVEMENT_THREAD : WORKING_THREADS.VERIFICATION_THREAD

                if(unstakerAccount.kly >= amount){

                    unstakerAccount.kly -= amount

                    poolStorage.totalStakedKly -= amount

                    if(unstakerAccount.kly === 0){

                        delete poolStorage.stakers[unstaker] // just to make pool storage more clear

                    }

                    if(threadContext === 'VERIFICATION_THREAD'){

                        // Pay back to staker
    
                        let unstakerAccount = await getFromState(shardWherePoolStorageLocated+':'+unstaker)
    
                        if(unstakerAccount){
    
                            amount = Number(amount.toFixed(9))

                            unstakerAccount.balance += amount

                            unstakerAccount.balance -= 0.000000001
    
                        }
    
                    }    

                }

                // Check if pool has not enough power to be at pools registry

                if(poolStorage.totalStakedKly < threadById.NETWORK_PARAMETERS.VALIDATOR_STAKE && threadById.EPOCH.poolsRegistry.includes(poolPubKey)){

                    // Remove from registry

                    let indexOfThisPool = threadById.EPOCH.poolsRegistry.indexOf(poolPubKey)

                    threadById.EPOCH.poolsRegistry.splice(indexOfThisPool, 1)

                    // ... and in case tx is runned in VERIFICATION_THREAD context - remove pool from VERIFICATION_STATS_PER_POOL
                    
                    if(threadContext === 'VERIFICATION_THREAD'){

                        delete WORKING_THREADS.VERIFICATION_THREAD[poolPubKey]
                        
                    }

                }

            } else return {isOk:false,reason:`Impossbile to unstake because tx.creator not a staker`}

        } else return {isOk:false,reason:'No such pool'}

    },


    /*

    delayedTransaction is:

    {
        type:'getRewardFromPool',

        rewardRecipient: transaction.creator,

        poolToGetRewardsFrom
    }
    
    */
    getRewardFromPool:async(threadContext,delayedTransaction) => {

        let {rewardRecipient,poolToGetRewardsFrom} = delayedTransaction

        if(threadContext === 'VERIFICATION_THREAD'){

            let shardWherePoolStorageLocated = await getFromState(poolToGetRewardsFrom+'(POOL)_POINTER').catch(()=>null)

            let poolStorage = await getFromState(shardWherePoolStorageLocated+':'+poolToGetRewardsFrom+'(POOL)_STORAGE_POOL').catch(()=>null)
    
            // You will be rewarded on the same shard where you made a stake on pool
    
            let accountOfStakerToReceiveRewards = await getFromState(shardWherePoolStorageLocated+':'+rewardRecipient).catch(()=>null)

            
            if(poolStorage && accountOfStakerToReceiveRewards && poolStorage.stakers[rewardRecipient]){

                let forReward = Number(poolStorage.stakers[delayedTransaction.creator].reward.toFixed(9))

                accountOfStakerToReceiveRewards.balance += forReward

                accountOfStakerToReceiveRewards.balance -= 0.000000001

                poolStorage.stakers[delayedTransaction.creator].reward = 0

                return {isOk:true}

            } else return {isOk:false,reason:`Impossbile to unstake because tx.creator not a staker or pool does not exist`}

        }

    },


    changeUnobtaniumAmount:async (threadContext,delayedTransaction)=>{



    }

}