import {execute} from './tools.mjs';
self.onmessage=e=>{try{self.postMessage({ok:true,result:execute(e.data.id,e.data.values)});}catch(error){self.postMessage({ok:false,error:error.message});}};
