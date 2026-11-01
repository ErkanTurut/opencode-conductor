import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { client } from './rpc'
export const Panel = Symbol('Panel'), Command = Symbol('Command'), MenuItem = Symbol('MenuItem'), Style = Symbol('Style')
export type PanelTab = { id: string; group: string; closable?: string; fallback?: boolean; title: string }
export type PanelProps = { tab: PanelTab; session: { directory: string }; screen?: unknown }
let pluginContext: any
export function usePlugin() { return pluginContext }
export const Plugin = { define: (definition: any) => definition }
export function mount(definition: any, outlet: HTMLElement) {
 const registry = new Map<symbol, any[]>(), [directory, setDirectory] = createSignal('/fixture/project-alpha'), [activeTab, setActiveTab] = createSignal('runs')
  const session = { get directory() { return directory() } }
  const [colorMode, setColorMode] = createSignal('dark')
  const t = (key:string, values?:Record<string,unknown>) => { let value=definition.i18n.en[key]??key; for(const [k,v] of Object.entries(values??{})) value=value.replaceAll(`{{${k}}}`,String(v)); return value }
  const ctx = { client, id:'preview', t, plural:(key:string,count:number)=>t(`${key}.${count===1?'one':'other'}`,{count}), system:{copy:(value:string)=>navigator.clipboard.writeText(value)}, add:(key:symbol,value:any)=>registry.set(key,[...(registry.get(key)??[]),value]), sessions:{current:()=>session}, layout:{open:(id:string)=>setActiveTab(id.split(':').pop()!),toggle:(id:string)=>setActiveTab(id.split(':').pop()!),state:()=> 'closed'} }
  Object.assign(ctx, { appearance: { mode: colorMode } })
  pluginContext=ctx; definition.setup(ctx)
 const panel=registry.get(Panel)![0], css=registry.get(Style)?.join('\n')??''
 const style=document.createElement('style'); style.textContent=css; document.head.append(style)
  const tabs = panel.list()
  const dispose=render(()=><><nav class="fixture-tabs">{tabs.map((item:any)=><button aria-pressed={activeTab()===item.id} onClick={()=>setActiveTab(item.id)}>{item.title}</button>)}</nav>{panel.render({get tab(){return tabs.find((item:any)=>item.id===activeTab())},session,screen:{}})}</>,outlet)
  return {setDirectory,setActiveTab,setColorMode,registry,dispose:()=>{dispose();style.remove()}}
}
