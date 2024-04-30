import { GET_FROM_APPROVEMENT_THREAD_STATE } from './approvement_thread_related.js'

import { GLOBAL_CACHES, WORKING_THREADS } from '../blockchain_preparation.js'

import { BLAKE3 } from '../../../KLY_Utils/utils.js'

import { HEAP_SORT } from '../utils.js'

export let GET_QUORUM_MAJORITY = epochHandler => {
    let quorumNumber = epochHandler.quorum.length

    let majority = Math.floor(quorumNumber * (2 / 3)) + 1

    //Check if majority is not bigger than number of pools. It's possible when there is a small number of pools

    return majority > quorumNumber ? quorumNumber : majority
}

export let GET_QUORUM_URLS_AND_PUBKEYS = async (withPubkey, epochHandler) => {
    let toReturn = []

    epochHandler ||= WORKING_THREADS.APPROVEMENT_THREAD.EPOCH

    for (let pubKey of epochHandler.quorum) {
        let poolStorage =
            GLOBAL_CACHES.APPROVEMENT_THREAD_CACHE.get(pubKey + '(POOL)_STORAGE_POOL') ||
            (await GET_FROM_APPROVEMENT_THREAD_STATE(pubKey + '(POOL)_STORAGE_POOL').catch(
                () => null
            ))

        if (poolStorage) {
            toReturn.push(withPubkey ? { url: poolStorage.poolURL, pubKey } : poolStorage.poolURL)
        }
    }

    return toReturn
}

export let GET_PSEUDO_RANDOM_SUBSET_FROM_QUORUM_BY_TICKET_ID = (ticketID, epochHandler) => {
    /*

        _________________DISCLAIMER_________________

        * The values of the network parameters in genesis may change before the launch or during the network operation
        ____________________________________________

        We need this function to get the minority of validators from quorum and send blocks only to them

        This is the improvement for Tachyon consensus where we need to send blocks only to 21 independent and pseudo-random validators from quorum

        Traditionally, in BFT blockchains, we assume that network is secured in case partition of stakes under control of malicious actor(s) are lower than 33%

        In KLY, we assume the security boundary is 20-21%(because of the following reasons) under control of bad guy:

            1) In case we have 1000 validators(what is normal value for top blockchains(see Solana, Avalanche, etc.)) and quorum size is 256.
            
            2) With these values, we can be sure that more than 67% of 256 validators in quorum will be honest players.
            
                The probability that >=33% of 256 will be bad actors is 1 case per 1M epoches. In case epoch is 1 day - this chance is equal to 1 case per 2739 years

            3) Now, to force shards leaders to send their blocks only to 21 validators we must accept the fact that all 21 randomly choosen validators from 256 should be fair
            
                and response with a valid signature to aggregate it and send as a proof to the rest of quorum:

                P(chance that in group of 21 all will be fair players) = C(172,21) / C(256,21) what is 0.0153 %

                P(chance that in group of 21 all will be bad actors) = C(84,21) / C(256,21) what is 1.03 * 10^-9 %

            4) Now, let each shard leader can choose random subminorities with size of 21 from quorum, saying 10 000 times

                This gives us that total chance to find a subset with 21 fair validators will be equal to 153 %,
                
                    while chance that in subset will be no at least one fair validator is equal to 1.03 * 10^-5 % - or approximately 1 case per 273 years 

            5) That's why, based on <quorum> and <ticketID>(in range 0-9999) we find the subset in quorum where the shard leader should send blocks



    */

    // If QUORUM_SIZE > 21 - do challenge, otherwise - return the whole quorum
    if (epochHandler.quorum.length > 21) {
        // Based on ticket_id + epochHandler.hash as a seed value - generate 21 values in range [0;quorum.size]

        // Then, return the resulting array of 21 validators by indexes in <quorum> array

        let subsetToReturn = []

        for (let i = 0; i < 21; i++) {
            let seed = BLAKE3(`${epochHandler.hash}:${ticketID}:${i}`)

            // Hex => Number
            let hashAsNumber = parseInt(seed, 16)

            // Normalize to [0, 1]
            let normalizedValue =
                hashAsNumber /
                (parseInt('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 16) +
                    1)

            let min = 0,
                max = epochHandler.quorum.length - 1

            // Normalize to [min, max]
            let scaledValue = min + Math.floor(normalizedValue * (max - min + 1))

            subsetToReturn.push(epochHandler.quorum[scaledValue])
        }

        return subsetToReturn
    } else return epochHandler.quorum
}

//We get the quorum based on pools' metadata(pass via parameter)

export let GET_CURRENT_EPOCH_QUORUM = (poolsRegistry, workflowOptions, newEpochSeed) => {
    let pools = poolsRegistry.primePools.concat(poolsRegistry.reservePools)

    //If more than QUORUM_SIZE pools - then choose quorum. Otherwise - return full array of pools
    if (pools.length > workflowOptions.QUORUM_SIZE) {
        let poolsMetadataHash = BLAKE3(JSON.stringify(poolsRegistry) + newEpochSeed),
            mapping = new Map(),
            sortedChallenges = HEAP_SORT(
                pools.map(validatorPubKey => {
                    let challenge = parseInt(BLAKE3(validatorPubKey + poolsMetadataHash), 16)

                    mapping.set(challenge, validatorPubKey)

                    return challenge
                })
            )

        return sortedChallenges
            .slice(0, workflowOptions.QUORUM_SIZE)
            .map(challenge => mapping.get(challenge))
    } else return pools
}
