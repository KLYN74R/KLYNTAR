import{BODY,SAFE_ADD,PARSE_JSON,BLAKE3} from '../../../KLY_Utils/utils.js'

import {BROADCAST,BLOCKLOG,VERIFY,SIG} from '../utils.js'

import Block from '../essences/block.js'




//______________________________________________________________MAIN PART________________________________________________________________________




let MAIN = {




//__________________________________________________________BASIC FUNCTIONAL_____________________________________________________________________




    block:a=>{

        let total=0,buf=Buffer.alloc(0)


        if(!CONFIG.SYMBIOTE.TRIGGERS.ACCEPT_BLOCKS){
            
            a.end('Route is off')
            
            return
        
        }

        a.writeHeader('Access-Control-Allow-Origin','*').onAborted(()=>a.aborted=true).onData(async(chunk,last)=>{
    
            if(total+chunk.byteLength<=CONFIG.MAX_PAYLOAD_SIZE){
            
                buf=await SAFE_ADD(buf,chunk,a)//build full data from chunks

                total+=chunk.byteLength
            
                if(last){
                
                    let block=await PARSE_JSON(buf),
                    
                        hash=Block.genHash(block.e,block.i,block.p),


                    //Check if we can accept this block
                    allow=
                
                    typeof block.e==='object'&&typeof block.i==='number'&&typeof block.p==='string'&&typeof block.sig==='string'//make general lightweight overview
                    &&
                    CONFIG.SYMBIOTE.TRIGGERS.BLOCKS//check if we should accept this block.NOTE-use this option only in case if you want to stop accept blocks or override this process via custom runtime scripts or external services
                    &&
                    await VERIFY(hash,block.sig,block.c)//and finally-the most CPU intensive task
                    
                    



                    if(allow){
                    
                        SYMBIOTE_META.CONTROLLER_BLOCKS.get(block.i).catch(e=>{

                            BLOCKLOG(`New \x1b[36m\x1b[41;1mblock\x1b[0m\x1b[32m accepted  \x1b[31m——│`,'S',block.c,hash,48,'\x1b[31m',block.i)
                            
                            //Store it locally-we'll work with this block later
                            SYMBIOTE_META.BLOCKS.put(block.i,block).then(()=>
                            
                                Promise.all(BROADCAST('/block',block))
                                
                            ).catch(e=>{})
                        
                        })
                    
                       !a.aborted&&a.end('OK')
    
                    }else !a.aborted&&a.end('Overview failed')

                }
            
            }else !a.aborted&&a.end('Payload limit')
        
        })
    
    },
    
    


    //Format of body : {symbiote,body}
    //There is no 'c'(creator) field-we get it from tx
    event:a=>a.writeHeader('Access-Control-Allow-Origin','*').onAborted(()=>a.aborted=true).onData(async v=>{
    
        let {symbiote,event}=await BODY(v,CONFIG.PAYLOAD_SIZE)
        
        //Reject all txs if route is off and other guards methods
        if(!(CONFIG.SYMBIOTE.SYMBIOTE_ID===symbiote&&CONFIG.SYMBIOTE.TRIGGERS.ACCEPT_EVENTS) || typeof event?.c!=='string' || typeof event.n!=='number' || typeof event.s!=='string'){
            
            !a.aborted&&a.end('Overview failed')
            
            return

        }

        
        /*
        
            ...and do such "lightweight" verification here to prevent db bloating
            Anyway we can bump with some short-term desynchronization while perform operations over block
            Verify and normalize object

            Fetch values about fees and MC from some DEZ sources

        */

        //The second operand tells us:if buffer is full-it makes whole logical expression FALSE
        //Also check if we have normalizer for this type of event
        if(SYMBIOTE_META.MEMPOOL.length<CONFIG.SYMBIOTE.EVENTS_MEMPOOL_SIZE && SYMBIOTE_META.FILTERS[event.t]){

            let filtered=await SYMBIOTE_META.FILTERS[event.t](symbiote,event)

            if(filtered){
    
                !a.aborted&&a.end('OK')

                SYMBIOTE_META.MEMPOOL.push(event)
                            
            }else !a.aborted&&a.end('Post overview failed')


        }else !a.aborted&&a.end('Mempool is fullfilled or no such filter')
    
    }),


    //[symbioteID,hostToAdd(initiator's valid and resolved host)]

    
    /*
                        
        Response consists of:

        +masterValidator(validator choosen for epoch - his BLS pubkey)
        +epochStart - height of block when epoch has started
        +validators - BLS pubkeys of current validators set
                            
        +signature(data is signed, so you will have proofs that you've received fake data from some sources)
                            
    */
    genThread:async(a,q)=>{
 
        a.onAborted(()=>a.aborted=true)

        if(CONFIG.SYMBIOTE.TRIGGERS.GET_GEN_THREAD && CONFIG.SYMBIOTE.SYMBIOTE_ID===q.getParameter(0)){


            let payload={
                
                masterValidator:SYMBIOTE_META.VERIFICATION_THREAD.MASTER_VALIDATOR,
                
                epochStart:SYMBIOTE_META.VERIFICATION_THREAD.EPOCH_START,
                
                validators:SYMBIOTE_META.VERIFICATION_THREAD.VALIDATORS
            
            },
        
                signature=await SIG(BLAKE3(payload.masterValidator+payload.epochStart+JSON.stringify(payload.validators)))

                console.log({payload,signature})

            !a.aborted&&a.end(JSON.stringify({payload,signature}))


        }else !a.aborted&&a.end('Symbiote not supported or route is off')
    
    },



    
//_____________________________________________________________AUXILARIES________________________________________________________________________




    //[symbioteID,hostToAdd(initiator's valid and resolved host)]
    addNode:a=>a.writeHeader('Access-Control-Allow-Origin','*').onAborted(()=>a.aborted=true).onData(async v=>{

        let [domain]=await BODY(v,CONFIG.PAYLOAD_SIZE)


        if(CONFIG.SYMBIOTE.TRIGGERS.ACCEPT_NEW_NODES&&typeof domain==='string'&&domain.length<=256){
            
            //Add more advanced logic in future(e.g instant single PING request or ask controller if this host asked him etc.)
            let nodes=SYMBIOTE_META.NEAR
            
            if(!(nodes.includes(domain) || CONFIG.SYMBIOTE.BOOTSTRAP_NODES.includes(domain))){
                
                nodes.length<CONFIG.SYMBIOTE.MAX_CONNECTIONS
                ?
                nodes.push(domain)
                :
                nodes[~~(Math.random() * nodes.length)]=domain//if no place-paste instead of random node

                !a.aborted&&a.end('OK')

            }else !a.aborted&&a.end('Domain already in scope')

        }else !a.aborted&&a.end('Wrong types')
    
    }),



    //Passive mode enabled by default    
    proof:a=>a.writeHeader('Access-Control-Allow-Origin','*').onAborted(()=>a.aborted=true).onData(async v=>{

        /*
        
        VERIFY signature and perform further logic
        Also,broadcast to the other nodes if signature is valid
        
        */

        // let {symbiote,ticker,KLYNTAR_HASH,HOSTCHAIN_HASH,INDEX,SIG}=await BODY(v,CONFIG.PAYLOAD_SIZE),
        
        //     workflowOk=true//by default.Can be changed in case if our local collapse is higher than index in proof


        // if(CONFIG.SYMBIOTE.SYMBIOTE_ID===symbiote && !CONFIG.SYMBIOTE.CONTROLLER.ME && await VERIFY(KLYNTAR_HASH+INDEX+HOSTCHAIN_HASH+ticker,SIG,symbiote)){

        //     //Ok,so firstly we can assume that we have appropriate proof with the same INDEX and HASH
        //     let alreadyHas=await SYMBIOTE_META.HOSTCHAINS_DATA.get(INDEX+ticker).catch(e=>{

        //         LOG(`No proof for \x1b[36;1m${INDEX} \u001b[38;5;3mblock \x1b[36;1m(hostchain:${ticker})\u001b[38;5;3m on \x1b[36;1m${SYMBIOTE_ALIAS()}\n${e}`,'W')

        //         return false

        //     })


        //     //If it's literally the same proof-just send OK
        //     if(alreadyHas.KLYNTAR_HASH===KLYNTAR_HASH && alreadyHas.INDEX===INDEX){
                
        //         !a.aborted&&a.end('OK')

        //         return

        //     }

        //     //If we're working higher than proof for some block we can check instantly
        //     SYMBIOTE_META.VERIFICATION_THREAD.COLLAPSED_INDEX>=INDEX
        //     &&
        //     await SYMBIOTE_META.CONTROLLER_BLOCKS.get(INDEX).then(async controllerBlock=>
                
        //         workflowOk= Block.genHash(controllerBlock.a,controllerBlock.i,controllerBlock.p)===KLYNTAR_HASH
        //                     &&
        //                     await HOSTCHAINS.get(ticker).checkTx(HOSTCHAIN_HASH,INDEX,KLYNTAR_HASH,symbiote).catch(
                                
        //                         error => {
                                    
        //                             LOG(`Can't check proof for \x1b[36;1m${INDEX}\u001b[38;5;3m on \x1b[36;1m${SYMBIOTE_ALIAS()}\u001b[38;5;3m to \x1b[36;1m${ticker}\u001b[38;5;3m.Check the error to get more info\n${error}`,'W')
                                    
        //                             return -1
                                
        //                         })

        //     ).catch(e=>
                
        //         //You also don't have ability to compare this if you don't have block locally
        //         LOG(`Can't check proof for \x1b[36;1m${INDEX}\u001b[38;5;3m on \x1b[36;1m${SYMBIOTE_ALIAS()}\u001b[38;5;3m to \x1b[36;1m${ticker}\u001b[38;5;3m coz you don't have local copy of block. Check your configs-probably your STORE_CONTROLLER_BLOCKS is false\n${e}`,'W')
                    
        //     )    

        //     //False only if proof is failed
        //     if(workflowOk){

        //         CONFIG.SYMBIOTE.WORKFLOW_CHECK.HOSTCHAINS[ticker].STORE//if option that we should locally store proofs is true
        //         &&
        //         SYMBIOTE_META.HOSTCHAINS_DATA
                
        //             .put(INDEX+ticker,{KLYNTAR_HASH,HOSTCHAIN_HASH,SIG})

        //             .then(()=>SYMBIOTE_META.HOSTCHAINS_DATA.put(ticker,{KLYNTAR_HASH,HOSTCHAIN_HASH,SIG,INDEX}))
                    
        //             .then(()=>LOG(`Proof for block \x1b[36;1m${INDEX}\x1b[32;1m on \x1b[36;1m${SYMBIOTE_ALIAS()}\x1b[32;1m to \x1b[36;1m${ticker}\x1b[32;1m verified and stored`,'S'))
                    
        //             .catch(e=>LOG(`Can't write proof for block \x1b[36;1m${INDEX}\u001b[38;5;3m on \x1b[36;1m${SYMBIOTE_ALIAS()}\u001b[38;5;3m to \x1b[36;1m${ticker}\u001b[38;5;3m`,'W'))


        //     }else if(workflowOk!==-1){
                
        //         LOG(fs.readFileSync(PATH_RESOLVE('images/events/fork.txt')).toString(),'F')

        //         LOG(`<WARNING>-found fork.Block \x1b[36;1m${INDEX}\x1b[31;1m on \x1b[36;1m${SYMBIOTE_ALIAS()}\x1b[31;1m to \x1b[36;1m${ticker}`,'F')
                
        //         //Further logic.For example-send report to another host to call some trigger
        //         SEND_REPORT(symbiote,{height:INDEX,hostchain:ticker,hostchainTx:HOSTCHAIN_HASH})

        //     }
            

        //     !a.aborted&&a.end('OK')

        //     Promise.all(BROADCAST('/proof',{symbiote,ticker,KLYNTAR_HASH,HOSTCHAIN_HASH,INDEX,SIG},symbiote))


        // }else !a.aborted&&a.end('Symbiote not supported or wrong signature')
    
    })

}


UWS_SERVER

.get('/genthread/:symbiote',MAIN.genThread)

.post('/addnode',MAIN.addNode)

.post('/block',MAIN.block)

.post('/proof',MAIN.proof)

.post('/event',MAIN.event)