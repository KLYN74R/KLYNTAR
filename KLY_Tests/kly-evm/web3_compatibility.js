import {Transaction} from '@ethereumjs/tx'
import {Common} from '@ethereumjs/common'
import Web3 from 'web3'


//___________________________________ CONSTANTS POOL ___________________________________


const web3 = new Web3('http://localhost:7331/kly_evm_rpc')

// KLY-EVM
const common = Common.custom({name:'KLYNTAR',networkId:7331,chainId:7331},'merge')

// EVM account

const evmAccount0 = {

    address:'0x4741c39e6096c192Db6E1375Ff32526512069dF5',
    privateKey:Buffer.from('d86dd54fd92f7c638668b1847aa3928f213db09ccda19f1a5f2badeae50cb93e','hex')

}

const evmAccount1 = {

    address:'0xdA0DD318C511025C87217D776Ac2C98E5f655fdC',
    privateKey:Buffer.from('43818ec87b33c38d65fe835e3143010fe08bce8da962aab996dc239229a6b574','hex')
  
}

const getGasAmountForContractCall = async (contract,checkpoint) => {

    let gasAmount = await contract.methods.checkpoint(checkpoint).estimateGas({from:evmAccount0.address});
    
    return gasAmount

}


//___________________________________________________________ TEST SECTION ___________________________________________________________



let DEFAULT_SIMPLE_QUERIES=async()=>{

    await web3.eth.getChainId().then(data=>console.log('Chain ID is => ',data)).catch(e=>console.log(e))

    await web3.eth.getBalance('0x4741c39e6096c192Db6E1375Ff32526512069dF5').then(balance=>console.log(`Balance of 0x4741c39e6096c192Db6E1375Ff32526512069dF5 is ${balance}`)).catch(e=>console.log(e))

    await web3.eth.getCoinbase().then(miner=>console.log('Coinbase is '+miner)).catch(e=>console.log(e))

    await web3.eth.getGasPrice().then(gasPrice=>console.log(`Gas price is ${web3.utils.fromWei(gasPrice.toString(),'Gwei')}`)).catch(e=>console.log(e))

    await web3.eth.getNodeInfo().then(nodeInfo=>console.log('Node info is',nodeInfo)).catch(e=>console.log(e))

    await web3.eth.getHashrate().then(hashRate=>console.log('Hashrate is ',hashRate)).catch(e=>console.log(e))

    await web3.eth.getTransactionCount('0x4741c39e6096c192Db6E1375Ff32526512069dF5').then(txCount=>console.log('Nonce for 0x4741c39e6096c192Db6E1375Ff32526512069dF5 is '+txCount)).catch(e=>console.log(e))

}

// DEFAULT_SIMPLE_QUERIES()

let EVM_DEFAULT_TX=async()=>{

    // Build a transaction
    let txObject = {
        
        nonce:web3.utils.toHex(0),

        to:evmAccount1.address,
        
        value: web3.utils.toHex(web3.utils.toWei('0.337','ether')),
        
        gasLimit: web3.utils.toHex(42000),
        
        gasPrice: web3.utils.toHex(web3.utils.toWei('10','gwei')),
    
        //Set payload in hex
        data: `0x${Buffer.from('💡 KLYNTAR -> 4e34d2a0b21c54a10a40c8d99187f8dcecebff501f9a15e09230f18ff2ac4808').toString('hex')}`
    
    }


    let tx = Transaction.fromTxData(txObject,{common}).sign(evmAccount0.privateKey)

    console.log('Tx hash is => ','0x'+tx.hash().toString('hex'))

    console.log(tx.toJSON())

    let raw = '0x' + tx.serialize().toString('hex')

	// Broadcast the transaction
    web3.eth.sendSignedTransaction(raw,(err,txHash) => console.log(err?`Oops,some has been occured ${err}`:`Success ———> ${txHash}`))

}

// EVM_DEFAULT_TX()


let EVM_CONTRACT_DEPLOY=async()=>{


    const initialCheckpoint = 'Hello from KLY-EVM by VladArtem'

    const TEST_KLY_EVM_CONTRACT = new web3.eth.Contract([{"inputs":[{"internalType":"string","name":"initialCheckpoint","type":"string"}],"stateMutability":"nonpayable","type":"constructor"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"string","name":"payload","type":"string"},{"indexed":false,"internalType":"uint256","name":"blocktime","type":"uint256"}],"name":"Checkpoint","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"string","name":"payload","type":"string"},{"indexed":false,"internalType":"uint256","name":"blocktime","type":"uint256"}],"name":"SkipProcedure","type":"event"},{"inputs":[{"internalType":"string","name":"aggregatedCheckpoint","type":"string"}],"name":"checkpoint","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"string","name":"skipMetadata","type":"string"}],"name":"skip","outputs":[],"stateMutability":"nonpayable","type":"function"}])

    const ABI_TO_DEPLOY = TEST_KLY_EVM_CONTRACT.deploy({
        
        data: '0x608060405234801561001057600080fd5b5060405161067a38038061067a833981810160405281019061003291906100e1565b7f5d882878f6c50530e63829854e64755332e385dbf9dd9c2798e07d9c88c67e408142604051610063929190610172565b60405180910390a1506102d6565b600061008461007f846101c7565b6101a2565b9050828152602081018484840111156100a05761009f6102b6565b5b6100ab84828561021e565b509392505050565b600082601f8301126100c8576100c76102b1565b5b81516100d8848260208601610071565b91505092915050565b6000602082840312156100f7576100f66102c0565b5b600082015167ffffffffffffffff811115610115576101146102bb565b5b610121848285016100b3565b91505092915050565b6000610135826101f8565b61013f8185610203565b935061014f81856020860161021e565b610158816102c5565b840191505092915050565b61016c81610214565b82525050565b6000604082019050818103600083015261018c818561012a565b905061019b6020830184610163565b9392505050565b60006101ac6101bd565b90506101b88282610251565b919050565b6000604051905090565b600067ffffffffffffffff8211156101e2576101e1610282565b5b6101eb826102c5565b9050602081019050919050565b600081519050919050565b600082825260208201905092915050565b6000819050919050565b60005b8381101561023c578082015181840152602081019050610221565b8381111561024b576000848401525b50505050565b61025a826102c5565b810181811067ffffffffffffffff8211171561027957610278610282565b5b80604052505050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052604160045260246000fd5b600080fd5b600080fd5b600080fd5b600080fd5b6000601f19601f8301169050919050565b610395806102e56000396000f3fe608060405234801561001057600080fd5b50600436106100365760003560e01c80636697a9251461003b5780636fad198f14610057575b600080fd5b6100556004803603810190610050919061015b565b610073565b005b610071600480360381019061006c919061015b565b6100af565b005b7f5d882878f6c50530e63829854e64755332e385dbf9dd9c2798e07d9c88c67e4081426040516100a49291906101ec565b60405180910390a150565b7f983b67a422dd57556c551b5d85141a480c1ac4a13b58597f3dc99f55a136777c81426040516100e09291906101ec565b60405180910390a150565b60006100fe6100f984610241565b61021c565b90508281526020810184848401111561011a5761011961033f565b5b610125848285610298565b509392505050565b600082601f8301126101425761014161033a565b5b81356101528482602086016100eb565b91505092915050565b60006020828403121561017157610170610349565b5b600082013567ffffffffffffffff81111561018f5761018e610344565b5b61019b8482850161012d565b91505092915050565b60006101af82610272565b6101b9818561027d565b93506101c98185602086016102a7565b6101d28161034e565b840191505092915050565b6101e68161028e565b82525050565b6000604082019050818103600083015261020681856101a4565b905061021560208301846101dd565b9392505050565b6000610226610237565b905061023282826102da565b919050565b6000604051905090565b600067ffffffffffffffff82111561025c5761025b61030b565b5b6102658261034e565b9050602081019050919050565b600081519050919050565b600082825260208201905092915050565b6000819050919050565b82818337600083830152505050565b60005b838110156102c55780820151818401526020810190506102aa565b838111156102d4576000848401525b50505050565b6102e38261034e565b810181811067ffffffffffffffff821117156103025761030161030b565b5b80604052505050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052604160045260246000fd5b600080fd5b600080fd5b600080fd5b600080fd5b6000601f19601f830116905091905056fea2646970667358221220b48f26e215a0efa0f6956dded49eaa4812541541cbe73e23d99ed3fcc667254564736f6c63430008070033',
        arguments: [initialCheckpoint]

    }).encodeABI()


    web3.eth.getTransactionCount(evmAccount1.address,async(err,txCount)=>{
			
        if(err) return

        // Build a transaction
        let txObject = {

            from:evmAccount0.address,

            nonce:web3.utils.toHex(txCount),
    
            //Set enough limit and price for gas
            gasLimit: web3.utils.toHex(800000),
    
            gasPrice: web3.utils.toHex(web3.utils.toWei('10','gwei')),
            
            //Set contract bytecode
            data: ABI_TO_DEPLOY

        }


        //Choose custom network
        let tx = Transaction.fromTxData(txObject,{common}).sign(evmAccount0.privateKey)

        //Sign the transaction
        tx.sign(evmAccount0.privateKey)

        console.log(tx)

        console.log('======== ESTIMATED =========')
        
        console.log(await web3.eth.estimateGas(txObject))

        console.log('Hash is => 0x'+tx.hash().toString('hex'))

        // console.log(await getGasAmountForContractCall('fdkfnkdjfnkjsdfnkddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'))

        let raw = '0x' + tx.serialize().toString('hex')

        console.log('Transaction(HEX) ———> ',raw)

        //Broadcast the transaction
        web3.eth.sendSignedTransaction(raw, (err, txHash) => console.log(err?`Oops,some has been occured ${err}`:`Success ———> ${txHash}`))

    })

}


// EVM_CONTRACT_DEPLOY()



let EVM_CONTRACT_CALL=async()=>{


    let accData = await GET_ACCOUNT_DATA(postQuantumDilithium.pub)

    console.log(accData)

    let pqcPayload={

        to:user0.pub,
        
        amount:1
    
    }

    let event = await GET_EVENT_TEMPLATE(postQuantumDilithium,TX_TYPES.TX,SIG_TYPES.POST_QUANTUM_DIL,accData.nonce+1,pqcPayload)

    console.log(event)


    let status = await SEND_EVENT(event)

    console.log(status)

}
