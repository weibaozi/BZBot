import { createServer,type ServerResponse } from 'node:http';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ModelConnection } from '../server/runner.ts';
/** Only the language model is scripted; the Codex subprocess and its tools are real. */
export async function localModel(dir:string){
  let hold=false,artifact=false;
  let command:string|undefined;
  let count=0;
  const toolOutputs:unknown[]=[];
  const bodies:Array<{tools?:Array<{type:string}>,input?:unknown,instructions?:string}>=[];
  const waiting:Array<()=>void>=[];
  const respond=(res:ServerResponse,output:unknown[])=>{
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const events=[{type:'response.created',response:{id:'resp_fixture',object:'response',status:'in_progress',output:[]}},
      ...output.map((item,output_index)=>({type:'response.output_item.done',output_index,item})),
      {type:'response.completed',response:{id:'resp_fixture',object:'response',status:'completed',output,usage:{input_tokens:2,output_tokens:2,total_tokens:4}}}];
    for(const event of events)res.write('data: '+JSON.stringify(event)+'\n\n');res.end();
  };
  const server=createServer((req,res)=>{
    let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{
      if(req.url!=='/v1/responses'){res.writeHead(404);res.end();return;}
      count++;
      const body=JSON.parse(raw);bodies.push(body);
      toolOutputs.push(...(body.input??[]).filter((item:{type:string})=>item.type==='function_call_output'));
      const send=()=>{
        if(res.destroyed)return;
        const toolReturned=(body.input??[]).some((item:{type:string})=>item.type==='function_call_output');
        if(artifact&&!toolReturned){
          respond(res,[{id:'fc_fixture',type:'function_call',call_id:'call_fixture',name:'exec_command',arguments:JSON.stringify({cmd:command??(process.platform==='win32'?"Set-Content -LiteralPath result.txt -Value 'fixture artifact'":"printf 'fixture artifact' > result.txt"),max_output_tokens:100})}]);
        }else respond(res,[{id:'msg_fixture',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'Completed fixture task: result.txt',annotations:[]}]}]);
      };
      if(hold)waiting.push(send);else send();
    });
  });
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const address=server.address();if(!address||typeof address==='string')throw new Error('No model port');
  const homeDir=join(dir,'codex-home');mkdirSync(homeDir,{recursive:true});
  const connection:ModelConnection={baseUrl:`http://127.0.0.1:${address.port}/v1`,homeDir,model:'fixture'};
  return {connection,toolOutputs,bodies,get requests(){return count;},hold(){hold=true;},release(){hold=false;while(waiting.length)waiting.shift()!();},artifact(cmd?:string){artifact=true;command=cmd;},
    async close(){server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}};
}
