import {symbiotes} from '../../klyn74r.js'

setTimeout(async()=>

    console.log(`Just dummy test custom script execution.1000th block is 
    
        ${JSON.stringify(await symbiotes.get('RqtrnrLAdxpUkjqKS42RKbgN1ryXad3NeJrPTBZpdyVL').CONTROLLER_BLOCKS.get(1000).catch(e=>'NOTHING'))}`
        
    ),5000
    
)