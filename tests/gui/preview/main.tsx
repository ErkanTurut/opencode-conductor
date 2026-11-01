import { createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import { render } from 'solid-js/web'
import definition from '../../../src/gui'
import { mount } from './host-mock'
import { configure, resetCalls, calls } from './rpc'
function App() {
 const [theme,setTheme]=createSignal('dark'), [width,setWidth]=createSignal('wide'), [scenario,setScenario]=createSignal('normal'), [project,setProject]=createSignal(false)
 let host:HTMLElement
 let controller:any
  const apply=()=>{configure({scenario:scenario(),project:project()});controller?.dispose();controller=mount(definition,host)}
  onMount(apply)
  createEffect(()=>{configure({scenario:scenario(),project:project()});controller?.setDirectory(project()?'/fixture/project-beta':'/fixture/project-alpha');controller?.setColorMode(theme())})
  onCleanup(()=>controller?.dispose())
 return <main data-theme={theme()} class={theme()}><header class="controls"><strong>Fixture preview — not live data</strong><select aria-label="Theme" onChange={e=>setTheme(e.currentTarget.value)}><option value="dark">Dark</option><option value="light">Light</option></select><select aria-label="Preview width" onChange={e=>setWidth(e.currentTarget.value)}><option value="wide">1100 × 700</option><option value="narrow">360 × 800</option><option value="bottom">1100 × 400 bottom panel</option></select><select aria-label="Scenario" onChange={e=>setScenario(e.currentTarget.value)}><option value="normal">Normal</option><option value="empty">Empty</option><option value="error">Error</option><option value="delay">Delayed response</option></select><button onClick={()=>setProject(!project())}>Switch fixture project</button><button onClick={()=>{resetCalls();apply()}}>Refresh fixture</button><span>{calls().length} fixture RPC calls</span></header><div class="frame" classList={{narrow:width()==='narrow',bottom:width()==='bottom'}}><div ref={host!} /></div></main>
}
const css=document.createElement('style');css.textContent=`*{box-sizing:border-box}body{margin:0;font:13px system-ui;background:#111;color:#eee}.controls{height:48px;display:flex;gap:10px;align-items:center;padding:6px 12px;background:#20242b;position:sticky;top:0;z-index:5}.controls button,.controls select{background:#303742;color:inherit;border:1px solid #596273;border-radius:5px;padding:5px}.frame{margin:24px auto;width:min(1100px,calc(100vw - 32px));height:700px;border:1px solid #414954;overflow:auto;background:#171a20}.frame.narrow{width:360px;height:800px;margin:10px auto}.frame.bottom{height:400px;width:1100px;max-width:calc(100vw - 32px)}.fixture-tabs{display:flex;gap:4px;background:#232832;padding:8px;position:sticky;top:0;z-index:2}.fixture-tabs button{background:transparent;color:inherit;border:0;padding:7px 10px;cursor:pointer}.fixture-tabs button:hover{background:#394150}main.light{background:#eee;color:#151515;min-height:100vh}.light .controls{background:#e2e6ec}.light .frame{background:#fff}.light .fixture-tabs{background:#e7eaf0}.light .fixture-tabs button{color:#222}`;document.head.append(css)
render(()=> <App/>,document.getElementById('app')!)
