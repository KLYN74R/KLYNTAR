/*

██╗  ██╗██╗  ██╗   ██╗███╗   ██╗████████╗ █████╗ ██████╗     ██╗    ██╗██╗   ██╗███╗   ███╗
██║ ██╔╝██║  ╚██╗ ██╔╝████╗  ██║╚══██╔══╝██╔══██╗██╔══██╗    ██║    ██║██║   ██║████╗ ████║
█████╔╝ ██║   ╚████╔╝ ██╔██╗ ██║   ██║   ███████║██████╔╝    ██║ █╗ ██║██║   ██║██╔████╔██║
██╔═██╗ ██║    ╚██╔╝  ██║╚██╗██║   ██║   ██╔══██║██╔══██╗    ██║███╗██║╚██╗ ██╔╝██║╚██╔╝██║
██║  ██╗███████╗██║   ██║ ╚████║   ██║   ██║  ██║██║  ██║    ╚███╔███╔╝ ╚████╔╝ ██║ ╚═╝ ██║
╚═╝  ╚═╝╚══════╝╚═╝   ╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝     ╚══╝╚══╝   ╚═══╝  ╚═╝     ╚═╝
                                                                                 

Here will be the implementation of VM for KLYNTAR to allow workflows to import it and use in code

*/




import ContractInstance from './rustBase.js'




export let WVM = {

    //Function to create a contract instance from WASM bytecode with injected metering function 
    bytesToMeteredContract:async(contractBytecodeAsBuffer,gasLimit,extraModules)=>{

        let contract = new ContractInstance(extraModules,contractBytecodeAsBuffer)

        let contractInstanceWithGasHandler = await contract.setUpContract(gasLimit) // return instance and pointer to metadata to track gas changes => {contractInstance,contractGasHandler}

        return contractInstanceWithGasHandler
        
    },


    /**
     * 
     *  
     * @param {*} contractInstance - WASM contract instance with injected modules e.g. "metering" and another extra functionality 
     * @param {*} contractGasHandler - handler for gas used metering
     * @param {Object} params - object that we should pass to contract
     * @param {*} functionName - function name of contract that we should call
     * @param {'Rust'|'AssemblyScript'} contractLang
     * @returns 
     */
    callContract:(contractInstance,contractGasHandler,params,functionName,contractLang)=>{

        let result

        if(contractLang==='Rust'){

            result = contractInstance[functionName](params)

        }else if(contractLang==='AssemblyScript'){

            let pointerToChunk = contractInstance.__newString(params);

            result = contractInstance.__getString(contractInstance[functionName](pointerToChunk))

        }

        // Returns result as JSON

        return {result,contractGasHandler}

    },

}