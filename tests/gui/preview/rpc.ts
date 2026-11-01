import { createSignal } from 'solid-js'
import * as f from './fixtures'
const [calls,setCalls]=createSignal<string[]>([])
let scenario='normal', project=false
export {calls}
export const resetCalls=()=>setCalls([])
export function configure(options:{scenario:string;project:boolean}){scenario=options.scenario;project=options.project}
const result=(data:any)=>({ok:true,data})
export const client={rpc:(_token:unknown)=>new Proxy({}, {get:(_,method:string)=>(input:any={},options:any={})=>{
 const directory=options?.location?.directory
 if(typeof directory!=='string'||!directory.startsWith('/fixture/')) throw Error('Preview RPC requires fixture location.directory')
 setCalls(old=>[...old,`${method} @ ${directory}`])
 if(scenario==='delay') return new Promise(resolve=>setTimeout(()=>resolve(response(method,input)),1400))
 return Promise.resolve(response(method,input))
 }})}
function response(method:string,input:any){
 if(scenario==='error')return {ok:false,error:{code:'FIXTURE_ERROR',message:'Synthetic fixture failure'}}
  const empty=scenario==='empty', runs=(empty?[]:f.runs).filter(run=>!input.states||input.states.includes(run.state))
 const data:any={workspace:{...f.workspace,projectRoot:project?'/fixture/project-beta':f.workspace.projectRoot},configuration:f.configuration,project:{...f.project,projectRoot:project?'/fixture/project-beta':f.project.projectRoot},runs:{runs:input.cursor?runs.slice(50):runs.slice(0,50),nextCursor:runs.length>50&&!input.cursor?'fixture-page-2':null},run:f.detail,dag:locationSearchLarge()?largeDag():f.dag,gates:f.gates,refinements:{runId:f.runs[0].id,state:'completed',uncertainties:[],qaPairs:[],outcome:'Fixture complete',requirementsPath:null,requirementsMarkdown:null,contract:{},events:[]},memory:empty?{blocks:[],total:0}:f.memory,memoryBlock:{block:f.memoryBlock},routing:f.routing,timeline:f.timeline}[method]
  if(method==='run')return result({...f.detail,summary:f.runs.find(run=>run.id===input.runId)??f.detail.summary})
  if(method==='dag')return result({...data,runId:input.runId})
  if(method==='timeline')return result({...f.timeline,events:f.timeline.events.filter(event=>event.sequence>(input.afterSequence??0))})
  return result(data??{})
}
function locationSearchLarge(){return new URLSearchParams((globalThis as {location?:{search:string}}).location?.search??'').get('large')==='1'}
function largeDag(){const nodes=Array.from({length:1200},(_,i)=>({id:`large-${i}`,title:`Large fixture node ${i}`,role:'coder',modelSlot:'implementation',state:'ready',priority:i,attempts:0,ghost:false,layer:i,dependencies:i?[`large-${i-1}`]:[]}));return {runId:f.runs[0].id,nodes,edges:nodes.slice(1).map((n,i)=>({from:`large-${i}`,to:n.id,resolved:true})),layers:nodes.map(n=>[n.id]),roots:['large-0'],leaves:['large-1199'],dangling:[],cycles:[],maxDepth:1200,maxDepthBudget:1200}}
