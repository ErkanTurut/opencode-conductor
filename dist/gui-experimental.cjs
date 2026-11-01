"use strict";Object.defineProperties(exports,{__esModule:{value:!0},[Symbol.toStringTag]:{value:"Module"}});const e=require("solid-js/web"),Se=require("@opencode/plugin/gui"),r=require("solid-js"),Tt=require("@opencode/plugin/rpc"),He={type:"object",properties:{},additionalProperties:!1},xe={type:"object",additionalProperties:!0};function ke(t,n=[]){return{type:"object",properties:t,...n.length>0?{required:[...n]}:{},additionalProperties:!1}}const Ce={type:"string"},ze={type:"number"},Ft={type:"array",items:Ce},Ot="conductor",Lt=Tt.Rpc.define({id:Ot,methods:{workspace:{input:He,output:xe},configuration:{input:He,output:xe},agentDocument:{input:ke({scope:{enum:["project","global"]},agentId:Ce},["scope","agentId"]),output:xe},saveAgentConfiguration:{input:ke({scope:{enum:["project","global"]},agentId:Ce,expectedRevision:Ce,fields:{type:"object",additionalProperties:!0}},["scope","agentId","expectedRevision","fields"]),output:xe},projectSettings:{input:He,output:xe},saveProjectSettings:{input:ke({expectedRevision:Ce,settings:{type:"object",additionalProperties:!0}},["expectedRevision","settings"]),output:xe},project:{input:He,output:xe},runs:{input:ke({limit:ze,cursor:Ce,states:Ft},[]),output:xe},run:{input:ke({runId:Ce},["runId"]),output:xe},dag:{input:ke({runId:Ce},["runId"]),output:xe},gates:{input:ke({runId:Ce},["runId"]),output:xe},refinements:{input:ke({runId:Ce},["runId"]),output:xe},memory:{input:ke({limit:ze},[]),output:xe},memoryBlock:{input:ke({label:Ce,version:ze},["label"]),output:xe},routing:{input:ke({runId:Ce},[]),output:xe},timeline:{input:ke({runId:Ce,afterSequence:ze,limit:ze},["runId"]),output:xe}},events:{}});function je(t){return typeof t=="object"&&t!==null&&!Array.isArray(t)}function Dt(t){if(t==null)return{data:null,error:"empty response"};if(je(t)){if(t.ok===!1){const n=je(t.error)?t.error:null,a=n&&typeof n.message=="string"&&n.message?n.message:"request failed";return{data:null,error:`${n&&typeof n.code=="string"&&n.code?`${n.code}: `:""}${a}`}}if(t.ok===!0&&"data"in t)return{data:t.data,error:null}}return{data:t,error:null}}function H(t){return Array.isArray(t)?t:[]}function At(t){return je(t)?t:{}}function w(t,n="unknown"){return typeof t=="string"&&t.length>0?t:typeof t=="number"&&Number.isFinite(t)||typeof t=="boolean"?String(t):n}const zt=["openQuestions","open_questions","questions","open"],Ut=["contract","refinement","requirements"];function Gt(t){if(typeof t=="string")return t;if(!je(t))return"";const n=t;for(const a of["question","title","text","prompt"]){const i=n[a];if(typeof i=="string"&&i.length>0)return i}return""}function Vt(t){if(!je(t))return!1;const n=t.answer;return typeof n=="string"?n.trim().length>0:!1}function dt(t,n){const a=[];for(const i of H(t)){if(!n&&Vt(i))continue;const l=Gt(i);l&&a.push(l)}return a}function Mt(t){if(Array.isArray(t))return dt(t,!0);if(!je(t))return[];for(const n of zt){const a=t[n];if(!Array.isArray(a))continue;const i=dt(a,n==="openQuestions"||n==="open_questions");if(i.length>0)return i}for(const n of Ut){const a=t[n];if(!je(a))continue;const i=Mt(a);if(i.length>0)return i}return[]}const Bt=new Set(["completed","cancelled","blocked","timed_out","failed"]),Ht=["created","intake","awaiting_refinement","discovered","planned","awaiting_plan_approval","executing","validating","reviewing","repairing","integrating","awaiting_merge_approval","paused"],Nt=t=>!Bt.has(t.state);function et(t,n){const a=new Set;return[...t,...n].filter(i=>!a.has(i.id)&&!!a.add(i.id))}function Jt(t,n,a,i){const l=a.trim().toLowerCase();return t.filter(m=>Nt(m)===n&&(!l||`${m.objective} ${m.id} ${m.state}`.toLowerCase().includes(l))).sort((m,g)=>i==="oldest"?m.updatedAt.localeCompare(g.updatedAt):i==="objective"?m.objective.localeCompare(g.objective):g.updatedAt.localeCompare(m.updatedAt))}function Wt(t){const n=t.counts??{},a=["failed","blocked","running","ready"].flatMap(i=>{const l=n[i];return typeof l=="number"&&l>0?[`${l} ${i}`]:[]});return a.length?a.join(", "):t.state.startsWith("awaiting_")?"Waiting for user input":t.state==="paused"?"Paused":"No recorded task activity"}function Qt(t,n){return t.width===n.width&&t.height===n.height&&t.nodes.length===n.nodes.length&&t.nodes.every((a,i)=>{const l=n.nodes[i];return l!==void 0&&a.id===l.id&&a.x===l.x&&a.y===l.y&&a.width===l.width&&a.height===l.height})}const Je={nodeWidth:168,nodeHeight:46,columnGap:12,layerGap:36};function We(t,n){return typeof t=="number"&&Number.isFinite(t)&&t>0?t:n}function T(t){return Math.round(t*10)/10}function Kt(t,n=[],a={},i="top-bottom"){const l={nodeWidth:We(a.nodeWidth,Je.nodeWidth),nodeHeight:We(a.nodeHeight,Je.nodeHeight),columnGap:We(a.columnGap,Je.columnGap),layerGap:We(a.layerGap,Je.layerGap)},m=new Set,g=[];for(const s of Array.isArray(t)?t:[]){const $=[];for(const h of Array.isArray(s)?s:[])typeof h!="string"||h.length===0||m.has(h)||(m.add(h),$.push(h));$.length>0&&g.push($)}const o=[];for(const s of n)typeof s!="string"||s.length===0||m.has(s)||(m.add(s),o.push(s));o.length>0&&g.push(o);const u=[],b=Object.create(null);let d=0;g.forEach((s,$)=>{const h=l.nodeWidth,x=s.length*h+Math.max(0,s.length-1)*l.columnGap;d=Math.max(d,x),s.forEach((E,N)=>{const C={id:E,layer:$,column:N,x:i==="top-bottom"?N*(l.nodeWidth+l.columnGap):$*(l.nodeWidth+l.layerGap),y:i==="top-bottom"?$*(l.nodeHeight+l.layerGap):N*(l.nodeHeight+l.columnGap),width:l.nodeWidth,height:l.nodeHeight};u.push(C),b[E]=C})});const p=g.length;let v=0;for(const s of g)v=Math.max(v,s.length);const y=i==="top-bottom"?p===0?0:p*l.nodeHeight+(p-1)*l.layerGap:v===0?0:v*l.nodeHeight+(v-1)*l.columnGap;return i==="left-right"&&(d=p===0?0:p*l.nodeWidth+(p-1)*l.layerGap),{nodes:u,byId:b,width:d,height:y,layerCount:p,unplaced:o}}function Yt(t,n,a="top-bottom",i=20){if(t.id===n.id){if(a==="left-right"){const p=t.y+t.height/2;return`M ${T(t.x)} ${T(p)} C ${T(t.x-i*2)} ${T(t.y-i)}, ${T(t.x-i*2)} ${T(t.y+t.height+i)}, ${T(t.x)} ${T(p)}`}const b=t.x+t.width/2,d=t.y;return`M ${T(b)} ${T(d)} C ${T(t.x+t.width+i)} ${T(t.y-i*2)}, ${T(t.x-i)} ${T(t.y-i*2)}, ${T(b)} ${T(d)}`}if(t.layer===n.layer){if(a==="left-right"){const v=Math.min(t.y,n.y),y=Math.max(t.y+t.height,n.y+n.height),s=Math.min(t.x,n.x)-i;return`M ${T(t.x)} ${T(t.y+t.height/2)} C ${T(s)} ${T(v-i)}, ${T(s)} ${T(y+i)}, ${T(n.x)} ${T(n.y+n.height/2)}`}const b=Math.min(t.x,n.x),d=Math.max(t.x+t.width,n.x+n.width),p=Math.min(t.y,n.y)-i;return`M ${T(t.x+t.width/2)} ${T(t.y)} C ${T(b-i)} ${T(p)}, ${T(d+i)} ${T(p)}, ${T(n.x+n.width/2)} ${T(n.y)}`}if(a==="left-right"){const b=n.x>=t.x,d=b?t.x+t.width:t.x,p=t.y+t.height/2,v=b?n.x:n.x+n.width,y=n.y+n.height/2,s=Math.max(16,Math.abs(v-d)/2);return[`M ${T(d)} ${T(p)}`,`C ${T(d+(b?s:-s))} ${T(p)},`,`${T(v-(b?s:-s))} ${T(y)},`,`${T(v)} ${T(y)}`].join(" ")}const l=t.x+t.width/2,m=t.y+t.height,g=n.x+n.width/2,o=n.y,u=Math.max(16,Math.abs(o-m)/2);return[`M ${T(l)} ${T(m)}`,`C ${T(l)} ${T(m+u)},`,`${T(g)} ${T(o-u)},`,`${T(g)} ${T(o)}`].join(" ")}function Zt(t,n="",a=[]){const i=n.trim().toLocaleLowerCase(),l=new Set(a),m=t.filter(g=>(!i||`${g.id} ${g.title??""} ${g.state??""}`.toLocaleLowerCase().includes(i))&&(l.size===0||l.has(g.state??"unknown")));return{visible:m,hiddenCount:t.length-m.length}}function Rt(t){return{x:Number.isFinite(t.x)?t.x:0,y:Number.isFinite(t.y)?t.y:0,scale:Number.isFinite(t.scale)?Math.max(1e-5,Math.min(2.5,t.scale)):1}}function Xt(t,n,a,i=28){const l=Math.max(1,t.width-Math.min(i*2,t.width*.5)),m=Math.max(1,t.height-Math.min(i*2,t.height*.5)),g=Math.min(1,l/Math.max(1,n),m/Math.max(1,a));return Rt({x:(t.width-n*g)/2,y:(t.height-a*g)/2,scale:g})}function ct(t,n,a,i=100){const l=Rt(n),m=-l.x/l.scale-i,g=-l.y/l.scale-i,o=m+a.width/l.scale+i*2,u=g+a.height/l.scale+i*2;return t.nodes.filter(b=>b.x+b.width>=m&&b.x<=o&&b.y+b.height>=g&&b.y<=u)}const en={pending:"pending",queued:"pending",planned:"pending",created:"pending",discovered:"pending",todo:"pending",intake:"ready",awaiting_refinement:"blocked",awaiting_plan_approval:"blocked",awaiting_merge_approval:"blocked",paused:"blocked",ready:"ready",running:"running",executing:"running",validating:"running",reviewing:"running",repairing:"running",integrating:"running",in_progress:"running",inprogress:"running",leased:"running",claimed:"running",dispatched:"running",completed:"completed",complete:"completed",succeeded:"completed",success:"completed",passed:"completed",done:"completed",approved:"completed",failed:"failed",failure:"failed",error:"failed",rejected:"failed",declined:"failed",cancelled:"failed",blocked:"blocked",waiting:"blocked",interrupted:"blocked",skipped:"unknown"};function Pe(t){return typeof t!="string"||t.length===0?"unknown":en[t.toLowerCase()]??"unknown"}function tn(t){if(typeof t!="string")return"unknown";const n=t.toLowerCase();return n==="approved"||n==="pass"||n==="passed"||n==="allow"?"completed":n==="rejected"||n==="denied"||n==="fail"||n==="failed"?"failed":n==="pending"||n==="requested"?"pending":Pe(n)}function Ge(t,n){return typeof t!="string"||n<=0?"":t.length<=n?t:`${t.slice(0,Math.max(0,n-1)).trimEnd()}…`}const Ue=1e3,Le=60*Ue,De=60*Le,tt=24*De;function nn(t,n=Date.now()){if(typeof t!="string"||t.length===0)return"unknown";const a=Date.parse(t);if(Number.isNaN(a))return"unknown";const i=Math.max(0,n-a);return i<45*Ue?"just now":i<De?`${Math.floor(i/Le)}m ago`:i<tt?`${Math.floor(i/De)}h ago`:i<7*tt?`${Math.floor(i/tt)}d ago`:t.slice(0,10)}function Ye(t){return typeof t!="string"||t.length===0||Number.isNaN(Date.parse(t))?"unknown":t.slice(0,16).replace("T"," ")}function rn(t){return typeof t!="string"||t.length===0||Number.isNaN(Date.parse(t))?"unknown":t.slice(0,10)}function jt(t){if(typeof t!="number"||!Number.isFinite(t)||t<0)return"unknown";if(t<Ue)return`${Math.round(t)}ms`;if(t<Le)return`${(t/Ue).toFixed(1)}s`;if(t<De){const i=Math.floor(t/Le),l=Math.floor(t%Le/Ue);return`${i}m ${String(l).padStart(2,"0")}s`}const n=Math.floor(t/De),a=Math.floor(t%De/Le);return`${n}h ${String(a).padStart(2,"0")}m`}function ut(t){return typeof t!="number"||!Number.isFinite(t)?null:t.toLocaleString("en-US")}function pt(t,n){if(typeof t!="number"||!Number.isFinite(t))return null;const a=typeof n=="string"&&n.length>0?n.toUpperCase():"USD",i=Math.abs(t)>0&&Math.abs(t)<.01?4:2;try{return new Intl.NumberFormat("en-US",{style:"currency",currency:a,maximumFractionDigits:i}).format(t)}catch{return`${t.toFixed(i)} ${a}`}}function an(t){return typeof t!="number"||!Number.isFinite(t)?"unknown":t>=0&&t<=1?`${Math.round(t*100)}%`:String(t)}function Pt(t,n){const a=t??{},i=typeof a.completed=="number"&&Number.isFinite(a.completed)?a.completed:0,l=Object.values(a).reduce((o,u)=>typeof u=="number"&&Number.isFinite(u)?o+u:o,0),m=typeof n=="number"&&Number.isFinite(n)&&n>0?n:l,g=m>0?Math.min(100,Math.round(i/m*100)):0;return{completed:i,total:m,percent:g}}var on=e.template("<span class=cdt-badge>"),ln=e.template("<div class=cdt-empty><span class=cdt-empty-title>"),sn=e.template("<span class=cdt-empty-body>"),dn=e.template("<div class=cdt-empty role=status aria-live=polite><span class=cdt-empty-body>"),cn=e.template('<section class=cdt-section><div class="cdt-row cdt-between"><h2 class=cdt-heading>');function ye(t){return(()=>{var n=on();return e.insert(n,()=>t.label),e.effect(a=>{var i=t.tone??"unknown",l=t.title??t.label;return i!==a.e&&e.setAttribute(n,"data-tone",a.e=i),l!==a.t&&e.setAttribute(n,"title",a.t=l),a},{e:void 0,t:void 0}),n})()}function Ae(t){return(()=>{var n=ln(),a=n.firstChild;return e.insert(a,()=>t.title),e.insert(n,(()=>{var i=e.memo(()=>!!t.body);return()=>i()?(()=>{var l=sn();return e.insert(l,()=>t.body),l})():null})(),null),n})()}function Ee(t){return(()=>{var n=dn(),a=n.firstChild;return e.insert(a,()=>t.label),n})()}function qe(t){return(()=>{var n=cn(),a=n.firstChild,i=a.firstChild;return e.insert(i,()=>t.title),e.insert(a,()=>t.aside,null),e.insert(n,()=>t.children,null),n})()}const un=`
.cdt-dag-toolbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:8px 0}
.cdt-dag-toolbar button,.cdt-dag-toolbar select,.cdt-dag-search{font:inherit;color:inherit;background:var(--cdt-node-bg);border:1px solid var(--cdt-border-strong);border-radius:5px;padding:4px 7px;min-height:28px}
.cdt-dag-search{min-width:130px;flex:1}
.cdt-dag-toolbar button{cursor:pointer}.cdt-dag-toolbar button:focus-visible,.cdt-dag-toolbar input:focus-visible,.cdt-dag-toolbar select:focus-visible,.cdt-dag-list button:focus-visible,.cdt-dag-node:focus-visible{outline:2px solid var(--primary,#8aa8ff);outline-offset:2px}
.cdt-dag-canvas{height:min(48vh,460px);min-height:220px;overflow:hidden;position:relative;border:1px solid var(--cdt-border-strong);border-radius:6px;background-color:var(--cdt-canvas-bg);background-image:radial-gradient(var(--cdt-border) .7px,transparent .7px);background-size:16px 16px;touch-action:pan-x pan-y}
.cdt-dag-inner{position:relative;will-change:transform}.cdt-dag-edges{position:absolute;inset:0;overflow:visible;pointer-events:none}.cdt-dag-edges marker path{fill:currentColor}
.cdt-dag-edge{fill:none;stroke:currentColor;stroke-width:1.4;opacity:.55;vector-effect:non-scaling-stroke}.cdt-dag-edge[data-resolved=false]{stroke-dasharray:4 3;opacity:.45}
.cdt-root .cdt-dag-node{position:absolute;display:flex;flex-direction:column;justify-content:center;gap:2px;text-align:left;overflow:hidden;padding:5px 7px;border:1px solid var(--cdt-border-strong);border-left:3px solid var(--cdt-tone);border-radius:5px;color:inherit;background:var(--cdt-node-bg);cursor:pointer}.cdt-dag-node[data-ghost=true]{border-style:dashed;opacity:.72}
.cdt-dag-title{font-size:12px;font-weight:600;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}.cdt-dag-meta{font-size:10px;color:var(--text-muted,#aaa);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cdt-dag-node[aria-pressed=true]{box-shadow:0 0 0 2px var(--primary,#8aa8ff)}
.cdt-dag-list{margin:8px 0}.cdt-dag-list summary{cursor:pointer;font-size:12px}.cdt-dag-list [role=list]{display:grid;gap:3px;max-height:220px;overflow:auto;margin-top:6px}.cdt-dag-list button{font:inherit;text-align:left;color:inherit;background:transparent;border:0;padding:4px;cursor:pointer}.cdt-dag-inspector{margin-top:8px}.cdt-dag-pagination{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:6px}.cdt-dag-overview-wrap{display:flex;align-items:center;gap:8px;margin-top:8px}.cdt-dag-overview{width:180px;height:72px;position:relative;overflow:hidden;border:1px solid var(--border,#45464d);border-radius:4px;background:var(--background-base,#17181c)}.cdt-dag-overview-node{position:absolute;width:3px;height:3px;padding:0;border:0;border-radius:50%;background:var(--text-muted,#aaa);cursor:pointer}.cdt-dag-overview-window{position:absolute;border:1px solid var(--primary,#8aa8ff);background:color-mix(in srgb,var(--primary,#8aa8ff) 12%,transparent);pointer-events:none}.cdt-dag-dependency{font:inherit;color:inherit;cursor:pointer}
@media(prefers-reduced-motion:reduce){.cdt-dag-inner{will-change:auto}}
.cdt-dag-overview{background:var(--cdt-canvas-bg);border-color:var(--cdt-border-strong)}
`;var pn=e.template("<style>"),gn=e.template("<p class=cdt-error>Cycle members (not an ordered path): "),mn=e.template('<p class="cdt-muted cdt-meta">Unresolved dependency ids: '),hn=e.template('<div class=cdt-dag-toolbar role=toolbar aria-label="Graph controls"><input class=cdt-dag-search aria-label="Search tasks"placeholder="Search tasks"><select aria-label="Filter by state"><option value>All states</option></select><button type=button aria-label="Zoom in">+</button><button type=button aria-label="Zoom out">-</button><button type=button>Fit</button><button type=button>Reset</button><button type=button>Top to bottom</button><button type=button>Left to right</button><span aria-live=polite> hidden'),fn=e.template('<div class=cdt-dag-canvas role=group aria-label="Task dependency graph. Use arrow keys to pan; hold Space and drag to pan."tabindex=0><div class=cdt-dag-inner style="transform-origin:top left"><svg class=cdt-dag-edges aria-hidden=true><defs><marker markerWidth=7 markerHeight=7 refX=6 refY=3.5 orient=auto><path d="M0,0 L7,3.5 L0,7 z">'),bn=e.template('<div class=cdt-dag-overview-wrap><svg class=cdt-dag-overview viewBox="0 0 180 72"role=img aria-label="Graph minimap. Click to navigate; use the task list for keyboard navigation."><rect fill="var(--primary, #8aa8ff)"fill-opacity=.12 stroke="var(--primary, #8aa8ff)"></rect></svg><span class="cdt-muted cdt-meta">Overview. Click to navigate; task list provides keyboard navigation.'),vn=e.template('<p class="cdt-muted cdt-meta">Showing <!> in viewport; <!> match filters of <!> total. Edges to filtered or offscreen nodes are hidden.'),$n=e.template("<p> tasks do not match the current search or state. Clear filters to reach them."),wn=e.template("<details class=cdt-dag-list><summary>Accessible task list (<!> matching tasks, <!> total)</summary><div role=list></div><div class=cdt-dag-pagination><button type=button>Previous page</button><span>Page <!> of </span><button type=button>Next page"),xn=e.template("<option>"),_n=e.template("<svg><path class=cdt-dag-edge></svg>",!1,!0,!1),yn=e.template("<button type=button class=cdt-dag-node><span class=cdt-dag-title></span><span class=cdt-dag-meta> - "),Sn=e.template('<svg><rect width=2 height=2 fill="var(--text-muted, #aaa)"></svg>',!1,!0,!1),Cn=e.template("<div role=listitem><button type=button> - "),kn=e.template('<div class="cdt-card cdt-dag-inspector"><div class="cdt-row cdt-between"><strong></strong></div><dl class=cdt-kv><dt>Role</dt><dd></dd><dt>Model slot</dt><dd></dd><dt>Attempts</dt><dd></dd><dt>Latest model</dt><dd></dd><dt>Attempt result</dt><dd></dd><dt>Verification</dt><dd></dd><dt>Acceptance criteria</dt><dd></dd><dt>Findings</dt><dd></dd><dt>Dependencies</dt><dd>'),gt=e.template("<ul>"),An=e.template("<li>"),Mn=e.template("<li> (<!>)"),Nn=e.template("<span class=cdt-chips>"),Rn=e.template('<button type=button class="cdt-chip cdt-dag-dependency">');const nt=100;function jn(t){const n=Se.usePlugin(),a=`cdt-dag-arrow-${r.createUniqueId().replace(/[^a-zA-Z0-9_-]/g,"")}`;let i;const[l,m]=r.createSignal(),[g,o]=r.createSignal(null),[u,b]=r.createSignal(""),[d,p]=r.createSignal(""),[v,y]=r.createSignal(1),[s,$]=r.createSignal({x:20,y:20}),[h,x]=r.createSignal("top-bottom"),[E,N]=r.createSignal({width:700,height:300}),[C,I]=r.createSignal(0),[M,O]=r.createSignal(null),te=r.createMemo(()=>t.data?.runId??null),J=r.createMemo(()=>H(t.data?.nodes)),B=r.createMemo(()=>new Map(J().map(c=>[c.id,c]))),q=r.createMemo(()=>Kt(t.data?.layers,J().map(c=>c.id),{},h()),void 0,{equals:Qt}),K=r.createMemo(()=>Zt(J(),u(),d()?[d()]:[])),se=r.createMemo(()=>new Set(ct(q(),{...s(),scale:v()},E()).map(c=>c.id))),X=r.createMemo(()=>{const c=q().byId;return H(t.data?.edges).flatMap(S=>{const k=c[S.from],P=c[S.to];return!k||!P||!W().has(S.from)||!W().has(S.to)||!se().has(S.from)||!se().has(S.to)?[]:[{...S,key:`${S.from}\0${S.to}`,path:Yt(k,P,h())}]})}),W=r.createMemo(()=>{const c=new Set(K().visible.map(S=>S.id));for(const S of q().nodes)B().has(S.id)||c.add(S.id);return c}),ae=r.createMemo(()=>{const c=W();return ct(q(),{...s(),scale:v()},E()).filter(S=>c.has(S.id))}),pe=r.createMemo(()=>g()?B().get(g())??null:null),ge=r.createMemo(()=>K().visible.slice(C()*nt,(C()+1)*nt)),me=r.createMemo(()=>Math.max(0,Math.ceil(K().visible.length/nt)-1)),_e=()=>{if(!i)return;const c=Xt({width:i.clientWidth,height:i.clientHeight},q().width,q().height);y(c.scale),$({x:c.x,y:c.y})},he=c=>{$({x:E().width/2-(c.x+c.width/2)*v(),y:E().height/2-(c.y+c.height/2)*v()})},be=c=>{o(c);const S=q().byId[c];S&&(v()<.65&&y(1),he(S))},G=(c,S)=>$(k=>({x:k.x+c,y:k.y+S}));return r.createEffect(()=>{te()&&(o(null),$({x:20,y:20}),y(1),b(""),p(""),I(0))}),r.createEffect(()=>{g()&&!B().has(g())&&o(null),I(c=>Math.min(c,me()))}),r.createEffect(()=>{const c=l();if(!c)return;const S=()=>N({width:c.clientWidth,height:c.clientHeight});S();const k=new ResizeObserver(S);k.observe(c),r.onCleanup(()=>k.disconnect())}),e.createComponent(qe,{get title(){return n.t("dag.title")},get children(){return[(()=>{var c=pn();return e.insert(c,un),c})(),e.createComponent(r.Show,{get when(){return t.hasRun},get fallback(){return e.createComponent(Ae,{get title(){return n.t("runs.noSelection")},get body(){return n.t("runs.empty.noSelection")}})},get children(){return e.createComponent(r.Show,{get when(){return t.data},get fallback(){return e.memo(()=>!!t.loading)()?e.createComponent(Ee,{get label(){return n.t("common.loading")}}):null},get children(){return e.createComponent(r.Show,{get when(){return q().nodes.length>0},get fallback(){return e.createComponent(Ae,{get title(){return n.t("dag.empty.title")},get body(){return n.t("dag.empty.body")}})},get children(){return[e.createComponent(r.Show,{get when(){return H(t.data?.cycles).length>0},get children(){var c=gn();return c.firstChild,e.insert(c,()=>H(t.data?.cycles).map(S=>S.join(", ")).join("; "),null),c}}),e.createComponent(r.Show,{get when(){return H(t.data?.dangling).length>0},get children(){var c=mn();return c.firstChild,e.insert(c,()=>H(t.data?.dangling).join(", "),null),c}}),(()=>{var c=hn(),S=c.firstChild,k=S.nextSibling;k.firstChild;var P=k.nextSibling,Y=P.nextSibling,f=Y.nextSibling,R=f.nextSibling,L=R.nextSibling,Q=L.nextSibling,V=Q.nextSibling,D=V.firstChild;return S.$$input=z=>{b(z.currentTarget.value),I(0)},k.addEventListener("change",z=>{p(z.currentTarget.value),I(0)}),e.insert(k,e.createComponent(r.For,{get each(){return[...new Set(J().map(z=>w(z.state,"unknown")))]},children:z=>(()=>{var oe=xn();return oe.value=z,e.insert(oe,z),oe})()}),null),P.$$click=()=>y(z=>Math.min(2.5,z*1.2)),Y.$$click=()=>y(z=>Math.max(1e-5,z/1.2)),f.$$click=_e,R.$$click=()=>{y(1),$({x:20,y:20})},L.$$click=()=>x("top-bottom"),Q.$$click=()=>x("left-right"),e.insert(V,()=>K().hiddenCount,D),e.effect(z=>{var oe=h()==="top-bottom",A=h()==="left-right";return oe!==z.e&&e.setAttribute(L,"aria-pressed",z.e=oe),A!==z.t&&e.setAttribute(Q,"aria-pressed",z.t=A),z},{e:void 0,t:void 0}),e.effect(()=>S.value=u()),e.effect(()=>k.value=d()),c})(),(()=>{var c=fn(),S=c.firstChild,k=S.firstChild,P=k.firstChild,Y=P.firstChild;return c.addEventListener("blur",()=>i?.removeAttribute("data-space-pan")),c.$$keyup=f=>{f.key===" "&&f.currentTarget.removeAttribute("data-space-pan")},c.addEventListener("pointercancel",()=>O(null)),c.$$pointerup=f=>{i?.hasPointerCapture(f.pointerId)&&i.releasePointerCapture(f.pointerId),O(null)},c.$$pointermove=f=>{const R=M();if(!R||R.pointerId!==f.pointerId)return;const L=f.clientX-R.px,Q=f.clientY-R.py;Math.hypot(L,Q)<4||(i?.hasPointerCapture(f.pointerId)||i?.setPointerCapture(f.pointerId),$({x:R.x+L,y:R.y+Q}))},c.$$pointerdown=f=>{if(f.target!==f.currentTarget&&!f.currentTarget.hasAttribute("data-space-pan")||f.button!==0)return;const R=s();O({x:R.x,y:R.y,px:f.clientX,py:f.clientY,pointerId:f.pointerId})},c.$$keydown=f=>{if(f.target!==f.currentTarget)return;const R=f.shiftKey?80:30;if(f.key===" "){f.currentTarget.setAttribute("data-space-pan","true"),f.preventDefault();return}if(f.key==="ArrowLeft")G(R,0);else if(f.key==="ArrowRight")G(-R,0);else if(f.key==="ArrowUp")G(0,R);else if(f.key==="ArrowDown")G(0,-R);else if(f.key==="+"||f.key==="=")y(L=>Math.min(2.5,L*1.2));else if(f.key==="-")y(L=>Math.max(1e-5,L/1.2));else return;f.preventDefault()},e.use(f=>{i=f,m(f)},c),e.setAttribute(Y,"id",a),e.insert(k,e.createComponent(r.For,{get each(){return X()},children:f=>(()=>{var R=_n();return e.setAttribute(R,"marker-end",`url(#${a})`),e.effect(L=>{var Q=f.resolved?"true":"false",V=f.path;return Q!==L.e&&e.setAttribute(R,"data-resolved",L.e=Q),V!==L.t&&e.setAttribute(R,"d",L.t=V),L},{e:void 0,t:void 0}),R})()}),null),e.insert(S,e.createComponent(r.For,{get each(){return ae()},children:f=>{const R=()=>B().get(f.id),L=()=>w(R()?.title,f.id),Q=()=>w(R()?.state,"unknown");return(()=>{var V=yn(),D=V.firstChild,z=D.nextSibling,oe=z.firstChild;return V.$$click=()=>be(f.id),e.insert(D,L),e.insert(z,Q,oe),e.insert(z,()=>w(R()?.role,"unknown"),null),e.effect(A=>{var re=Pe(R()?.state),Z=R()?.ghost||!R()?"true":"false",ve=g()===f.id,$e=`${L()}, ${Q()}`,le=`${f.x}px`,ne=`${f.y}px`,Ie=`${f.width}px`,Oe=`${f.height}px`;return re!==A.e&&e.setAttribute(V,"data-tone",A.e=re),Z!==A.t&&e.setAttribute(V,"data-ghost",A.t=Z),ve!==A.a&&e.setAttribute(V,"aria-pressed",A.a=ve),$e!==A.o&&e.setAttribute(V,"aria-label",A.o=$e),le!==A.i&&e.setStyleProperty(V,"left",A.i=le),ne!==A.n&&e.setStyleProperty(V,"top",A.n=ne),Ie!==A.s&&e.setStyleProperty(V,"width",A.s=Ie),Oe!==A.h&&e.setStyleProperty(V,"height",A.h=Oe),A},{e:void 0,t:void 0,a:void 0,o:void 0,i:void 0,n:void 0,s:void 0,h:void 0}),V})()}}),null),e.effect(f=>{var R=`${q().width}px`,L=`${q().height}px`,Q=`translate(${s().x}px, ${s().y}px) scale(${v()})`,V=q().width,D=q().height;return R!==f.e&&e.setStyleProperty(S,"width",f.e=R),L!==f.t&&e.setStyleProperty(S,"height",f.t=L),Q!==f.a&&e.setStyleProperty(S,"transform",f.a=Q),V!==f.o&&e.setAttribute(k,"width",f.o=V),D!==f.i&&e.setAttribute(k,"height",f.i=D),f},{e:void 0,t:void 0,a:void 0,o:void 0,i:void 0}),c})(),(()=>{var c=bn(),S=c.firstChild,k=S.firstChild;return S.$$click=P=>{const Y=P.currentTarget.getBoundingClientRect(),f=(P.clientX-Y.left)/Y.width*q().width,R=(P.clientY-Y.top)/Y.height*q().height;let L,Q=1/0;for(const V of q().nodes){const D=Math.hypot(V.x+V.width/2-f,V.y+V.height/2-R);D<Q&&(L=V,Q=D)}L&&he(L)},e.insert(S,e.createComponent(r.For,{get each(){return q().nodes},children:P=>(()=>{var Y=Sn();return e.effect(f=>{var R=q().width?P.x/q().width*176:0,L=q().height?P.y/q().height*68:0;return R!==f.e&&e.setAttribute(Y,"x",f.e=R),L!==f.t&&e.setAttribute(Y,"y",f.t=L),f},{e:void 0,t:void 0}),Y})()}),k),e.effect(P=>{var Y=Math.max(0,-s().x/v()/Math.max(q().width,1)*176),f=Math.max(0,-s().y/v()/Math.max(q().height,1)*68),R=Math.min(176,E().width/v()/Math.max(q().width,1)*176),L=Math.min(68,E().height/v()/Math.max(q().height,1)*68);return Y!==P.e&&e.setAttribute(k,"x",P.e=Y),f!==P.t&&e.setAttribute(k,"y",P.t=f),R!==P.a&&e.setAttribute(k,"width",P.a=R),L!==P.o&&e.setAttribute(k,"height",P.o=L),P},{e:void 0,t:void 0,a:void 0,o:void 0}),c})(),(()=>{var c=vn(),S=c.firstChild,k=S.nextSibling,P=k.nextSibling,Y=P.nextSibling,f=Y.nextSibling,R=f.nextSibling;return R.nextSibling,e.insert(c,()=>ae().length,k),e.insert(c,()=>K().visible.length,Y),e.insert(c,()=>J().length,R),c})(),(()=>{var c=wn(),S=c.firstChild,k=S.firstChild,P=k.nextSibling,Y=P.nextSibling,f=Y.nextSibling;f.nextSibling;var R=S.nextSibling,L=R.nextSibling,Q=L.firstChild,V=Q.nextSibling,D=V.firstChild,z=D.nextSibling;z.nextSibling;var oe=V.nextSibling;return e.insert(S,()=>K().visible.length,P),e.insert(S,()=>J().length,f),e.insert(R,e.createComponent(r.For,{get each(){return ge()},children:A=>(()=>{var re=Cn(),Z=re.firstChild,ve=Z.firstChild;return Z.$$click=()=>be(A.id),e.insert(Z,()=>w(A.title,A.id),ve),e.insert(Z,()=>w(A.state,"unknown"),null),e.effect(()=>e.setAttribute(Z,"aria-current",g()===A.id?"true":void 0)),re})()})),Q.$$click=()=>I(A=>Math.max(0,A-1)),e.insert(V,()=>C()+1,z),e.insert(V,()=>me()+1,null),oe.$$click=()=>I(A=>Math.min(me(),A+1)),e.insert(c,e.createComponent(r.Show,{get when(){return K().hiddenCount>0},get children(){var A=$n(),re=A.firstChild;return e.insert(A,()=>K().hiddenCount,re),A}}),null),e.effect(A=>{var re=C()===0,Z=C()>=me();return re!==A.e&&(Q.disabled=A.e=re),Z!==A.t&&(oe.disabled=A.t=Z),A},{e:void 0,t:void 0}),c})(),e.createComponent(r.Show,{get when(){return pe()},children:c=>{const S=()=>t.detail?.tasks.find(f=>f.id===c().id),k=()=>S()?.latestAttempt,P=()=>t.gates?.tasks.find(f=>f.taskId===c().id),Y=()=>H(c().dependencies);return(()=>{var f=kn(),R=f.firstChild,L=R.firstChild,Q=R.nextSibling,V=Q.firstChild,D=V.nextSibling,z=D.nextSibling,oe=z.nextSibling,A=oe.nextSibling,re=A.nextSibling,Z=re.nextSibling,ve=Z.nextSibling,$e=ve.nextSibling,le=$e.nextSibling,ne=le.nextSibling,Ie=ne.nextSibling,Oe=Ie.nextSibling,Te=Oe.nextSibling,Ze=Te.nextSibling,Ve=Ze.nextSibling,Xe=Ve.nextSibling,F=Xe.nextSibling;return e.insert(L,()=>w(c().title,c().id)),e.insert(R,e.createComponent(ye,{get tone(){return Pe(c().state)},get label(){return w(c().state,"unknown")}}),null),e.insert(D,()=>w(c().role,"unknown")),e.insert(oe,()=>w(c().modelSlot,"unknown")),e.insert(re,()=>w(c().attempts,"0")),e.insert(ve,(()=>{var j=e.memo(()=>!!k());return()=>j()?`${k()?.modelProvider}/${k()?.modelId}${k()?.modelVariant?` (${k()?.modelVariant})`:""}`:"No recorded attempt"})()),e.insert(le,(()=>{var j=e.memo(()=>!!k());return()=>j()?`${k()?.state}; exit ${k()?.exitCode??"unknown"}${k()?.failureClass?`; ${k()?.failureClass}`:""}${k()?.startedAt&&k()?.finishedAt&&Number.isFinite(Date.parse(k().finishedAt)-Date.parse(k().startedAt))?`; ${Math.max(0,Date.parse(k().finishedAt)-Date.parse(k().startedAt))} ms`:""}`:"No recorded attempt"})()),e.insert(Ie,(()=>{var j=e.memo(()=>P()?.passed===!0);return()=>j()?"Passed":P()?.passed===!1?"Failed":"No proof recorded"})()),e.insert(Te,(()=>{var j=e.memo(()=>!!S()?.acceptanceCriteria?.length);return()=>j()?(()=>{var U=gt();return e.insert(U,e.createComponent(r.For,{get each(){return S().acceptanceCriteria},children:ie=>(()=>{var _=An();return e.insert(_,ie),_})()})),U})():"Not provided"})()),e.insert(Ve,(()=>{var j=e.memo(()=>!!P()?.findings.length);return()=>j()?(()=>{var U=gt();return e.insert(U,e.createComponent(r.For,{get each(){return P().findings},children:ie=>(()=>{var _=Mn(),ee=_.firstChild,ce=ee.nextSibling;return ce.nextSibling,e.insert(_,()=>ie.title,ee),e.insert(_,()=>ie.status,ce),_})()})),U})():"No findings recorded"})()),e.insert(F,(()=>{var j=e.memo(()=>!!Y().length);return()=>j()?(()=>{var U=Nn();return e.insert(U,e.createComponent(r.For,{get each(){return Y()},children:ie=>(()=>{var _=Rn();return _.$$click=()=>be(ie),e.insert(_,()=>w(B().get(ie)?.title,ie)),_})()})),U})():"None"})()),f})()}})]}})}})}})]}})}e.delegateEvents(["input","click","keydown","pointerdown","pointermove","pointerup","keyup"]);var Pn=e.template("<div class=cdt-inspector-note><strong>Not merge authorization.</strong> Recorded evidence does not authorize a push or merge."),mt=e.template("<ul class=cdt-list>"),En=e.template("<section class=cdt-section><h3 class=cdt-heading>"),qn=e.template("<section class=cdt-section><h3 class=cdt-heading></h3><ul class=cdt-list>"),In=e.template("<p>Evidence readiness is unavailable for this server."),Tn=e.template("<ul>"),Fn=e.template("<li>"),rt=e.template('<p class="cdt-muted cdt-meta">'),ht=e.template("<span aria-hidden=true>&middot;"),ft=e.template("<span>"),On=e.template('<li class="cdt-card cdt-card-tight"><div class="cdt-row cdt-between cdt-gap"><span class=cdt-strong></span></div><div class="cdt-row cdt-wrap cdt-meta cdt-muted"><span>: </span><span aria-hidden=true>&middot;</span><time>'),Ln=e.template("<span class=cdt-label>"),Dn=e.template('<li class=cdt-card><div class="cdt-row cdt-between cdt-gap"><span class=cdt-strong></span></div><div class="cdt-row cdt-wrap cdt-meta cdt-muted"></div><span class=cdt-label>'),zn=e.template('<span class="cdt-mono cdt-muted">'),Un=e.template('<li class=cdt-verify><code class=cdt-command></code><div class="cdt-row cdt-wrap cdt-meta"><span class=cdt-muted></span><span class=cdt-muted>'),Gn=e.template("<span class=cdt-mono>"),Vn=e.template("<p class=cdt-evidence>"),Bn=e.template("<p class=cdt-required><span class=cdt-label>"),Hn=e.template('<div class=cdt-finding><div class="cdt-row cdt-between cdt-gap"><span class=cdt-strong></span></div><div class="cdt-meta cdt-muted"> · ');function Jn(t){const n=Se.usePlugin(),a=()=>H(t.data?.approvals),i=()=>H(t.data?.tasks),l=m=>typeof m!="boolean"?n.t("gates.notRun"):m?n.t("gates.passed"):n.t("gates.failed");return e.createComponent(qe,{get title(){return n.t("gates.title")},get aside(){return e.createComponent(r.Show,{get when(){return t.data},get children(){return e.createComponent(ye,{get tone(){return e.memo(()=>!!t.data?.readiness)()?t.data.readiness.evidenceReady?"completed":"blocked":"unknown"},get label(){return e.memo(()=>!!t.data?.readiness)()?t.data.readiness.evidenceReady?"Evidence ready":"Evidence incomplete":"Evidence readiness unknown"}})}})},get children(){return e.createComponent(r.Show,{get when(){return t.hasRun},get fallback(){return e.createComponent(Ae,{get title(){return n.t("runs.noSelection")},get body(){return n.t("runs.empty.noSelection")}})},get children(){return e.createComponent(r.Show,{get when(){return t.data},get fallback(){return e.memo(()=>!!t.loading)()?e.createComponent(Ee,{get label(){return n.t("common.loading")}}):null},get children(){return[(()=>{var m=Pn(),g=m.firstChild;return g.nextSibling,e.insert(m,e.createComponent(r.Show,{get when(){return t.data?.readiness},get fallback(){return In()},children:o=>e.createComponent(r.Show,{get when(){return H(o().reasons).length>0},get children(){var u=Tn();return e.insert(u,e.createComponent(r.For,{get each(){return H(o().reasons)},children:b=>(()=>{var d=Fn();return e.insert(d,b),d})()})),u}})}),null),m})(),e.createComponent(r.Show,{get when(){return a().length>0||i().length>0},get fallback(){return e.createComponent(Ae,{get title(){return n.t("gates.empty.title")},get body(){return n.t("gates.empty.body")}})},get children(){return[(()=>{var m=En(),g=m.firstChild;return e.insert(g,()=>n.t("gates.approvals")),e.insert(m,e.createComponent(r.Show,{get when(){return a().length>0},get fallback(){return(()=>{var o=rt();return e.insert(o,()=>n.t("gates.noApprovals")),o})()},get children(){var o=mt();return e.insert(o,e.createComponent(r.For,{get each(){return a()},children:u=>(()=>{var b=On(),d=b.firstChild,p=d.firstChild,v=d.nextSibling,y=v.firstChild,s=y.firstChild,$=y.nextSibling,h=$.nextSibling;return e.insert(p,()=>w(u.gate,n.t("common.unknown"))),e.insert(d,e.createComponent(ye,{get tone(){return tn(u.decision)},get label(){return w(u.decision,n.t("common.unknown"))}}),null),e.insert(y,()=>n.t("gates.actor"),s),e.insert(y,()=>w(u.actor,n.t("common.unknown")),null),e.insert(h,()=>Ye(u.createdAt)),e.insert(v,e.createComponent(r.Show,{get when(){return u.expiresAt},get children(){return[ht(),(()=>{var x=ft();return e.insert(x,()=>n.t("gates.expires",{when:Ye(u.expiresAt)})),x})()]}}),null),e.effect(()=>e.setAttribute(h,"datetime",w(u.createdAt,""))),b})()})),o}}),null),e.effect(()=>e.setAttribute(m,"aria-label",n.t("gates.approvals"))),m})(),(()=>{var m=qn(),g=m.firstChild,o=g.nextSibling;return e.insert(g,()=>n.t("gates.verification")),e.insert(o,e.createComponent(r.For,{get each(){return i()},children:u=>{const b=()=>H(u.verifications),d=()=>H(u.findings);return(()=>{var p=Dn(),v=p.firstChild,y=v.firstChild,s=v.nextSibling,$=s.nextSibling;return e.insert(y,()=>w(u.title,u.taskId)),e.insert(v,e.createComponent(ye,{get tone(){return Pe(u.state)},get label(){return w(u.state,n.t("common.unknown"))}}),null),e.insert(s,e.createComponent(r.Show,{get when(){return typeof u.attemptNo=="number"},get children(){return[(()=>{var h=ft();return e.insert(h,()=>n.t("gates.attempt",{no:w(u.attemptNo,"0")})),h})(),ht()]}}),null),e.insert(s,e.createComponent(ye,{get tone(){return e.memo(()=>typeof u.passed=="boolean")()?u.passed?"completed":"failed":"pending"},get label(){return l(u.passed)}}),null),e.insert(s,e.createComponent(r.Show,{get when(){return u.blockingFindings>0},get children(){return e.createComponent(ye,{tone:"failed",get label(){return`${w(u.blockingFindings,"0")} ${n.t("gates.blocking")}`}})}}),null),e.insert(s,e.createComponent(r.Show,{get when(){return u.openFindings>0},get children(){return e.createComponent(ye,{tone:"pending",get label(){return`${w(u.openFindings,"0")} ${n.t("gates.open")}`}})}}),null),e.insert($,()=>n.t("gates.verification")),e.insert(p,e.createComponent(r.Show,{get when(){return b().length>0},get fallback(){return(()=>{var h=rt();return e.insert(h,()=>n.t("gates.noVerifications")),h})()},get children(){var h=mt();return e.insert(h,e.createComponent(r.For,{get each(){return b()},children:x=>(()=>{var E=Un(),N=E.firstChild,C=N.nextSibling,I=C.firstChild,M=I.nextSibling;return e.insert(N,()=>w(x.command,n.t("common.unknown"))),e.insert(C,e.createComponent(ye,{get tone(){return x.passed?"completed":"failed"},get label(){return e.memo(()=>!!x.passed)()?n.t("gates.passed"):n.t("gates.failed")}}),I),e.insert(I,()=>n.t("gates.exit",{code:w(x.exitCode,"?")})),e.insert(M,()=>jt(x.durationMs)),e.insert(C,e.createComponent(r.Show,{get when(){return x.outputHash},get children(){var O=zn();return e.insert(O,()=>Ge(x.outputHash,12)),e.effect(()=>e.setAttribute(O,"title",x.outputHash)),O}}),null),e.effect(()=>e.setAttribute(N,"title",x.command)),E})()})),h}}),null),e.insert(p,e.createComponent(r.Show,{get when(){return d().length>0},get children(){return[(()=>{var h=Ln();return e.insert(h,()=>n.t("gates.findings")),h})(),e.createComponent(r.For,{get each(){return d()},children:h=>(()=>{var x=Hn(),E=x.firstChild,N=E.firstChild,C=E.nextSibling,I=C.firstChild;return e.insert(N,()=>w(h.title,n.t("common.unknown"))),e.insert(E,e.createComponent(ye,{get tone(){return h.blocking?"failed":"pending"},get label(){return w(h.severity,n.t("common.unknown"))}}),null),e.insert(C,()=>w(h.category,n.t("common.unknown")),I),e.insert(C,()=>w(h.status,n.t("common.unknown")),null),e.insert(C,e.createComponent(r.Show,{get when(){return h.location},get children(){return[" · ",(()=>{var M=Gn();return e.insert(M,()=>h.location),M})()]}}),null),e.insert(x,e.createComponent(r.Show,{get when(){return h.evidence},get children(){var M=Vn();return e.insert(M,()=>Ge(h.evidence,260)),M}}),null),e.insert(x,e.createComponent(r.Show,{get when(){return h.requiredFix},get children(){var M=Bn(),O=M.firstChild;return e.insert(O,()=>n.t("gates.requiredFix")),e.insert(M,()=>h.requiredFix,null),M}}),null),e.effect(()=>e.setAttribute(x,"data-blocking",h.blocking?"true":"false")),x})()})]}}),null),e.insert(p,e.createComponent(r.Show,{get when(){return d().length===0},get children(){var h=rt();return e.insert(h,()=>n.t("gates.noFindings")),h}}),null),p})()}})),e.effect(()=>e.setAttribute(m,"aria-label",n.t("gates.verification"))),m})()]}})]}})}})}})}var Wn=e.template("<ul class=cdt-list>"),Qn=e.template('<span class="cdt-muted cdt-meta">'),Kn=e.template('<span class="cdt-meta cdt-muted">Review reasons: '),Yn=e.template("<span class=cdt-memory-preview>"),Zn=e.template("<div class=cdt-memory-content>"),Xn=e.template('<li><button type=button class=cdt-memory><span class="cdt-row cdt-between cdt-gap"><span class=cdt-strong></span><span class="cdt-row cdt-gap"><span class="cdt-mono cdt-muted cdt-meta"></span></span></span><span class="cdt-row cdt-wrap cdt-meta cdt-muted"><span>: </span><span aria-hidden=true>&middot;</span><span>: </span><span aria-hidden=true>&middot;</span><span></span></span><span class="cdt-row cdt-wrap cdt-meta"><span>Review: </span><span aria-hidden=true>&middot;</span><span>Eligible: </span></span><span class="cdt-meta cdt-muted">Source run: </span><span class=cdt-label>'),bt=e.template('<p class="cdt-muted cdt-meta">'),er=e.template("<p><strong>Reasons:</strong> "),tr=e.template("<p><strong>Supersedes:</strong> "),nr=e.template("<div class=cdt-inspector-review><p><strong>Review classification:</strong> </p><p><strong>Eligibility:</strong> </p><p><strong>Suggested action:</strong> </p><p><strong>Source run:</strong> </p><p><strong>Source artifacts:</strong> </p><p><strong>Actor:</strong> <!> · <strong>Content hash:</strong> "),rr=e.template("<pre class=cdt-pre tabindex=0>");function ir(t,n,a,i,l){return!t&&n===a&&i===l}function vt(t){return`${t.label}@${t.version}`}function ar(t){const n=Se.usePlugin(),[a,i]=r.createSignal(null),[l,m]=r.createSignal({}),[g,o]=r.createSignal({});let u=0,b=!1,d=t.scopeKey;r.createEffect(()=>{d=t.scopeKey,u++,i(null),m({}),o({})}),r.onCleanup(()=>{b=!0,u++});const p=()=>H(t.data?.blocks);async function v(y){const s=vt(y);if(a()===s){i(null);return}if(i(s),Object.prototype.hasOwnProperty.call(l(),s)||g()[s])return;const $=u,h=t.scopeKey;o(E=>({...E,[s]:!0}));let x=null;try{x=await t.loadBlock(w(y.label,""),y.version)}catch{}ir(b,u,$,t.scopeKey,h)&&(o(E=>({...E,[s]:!1})),m(E=>({...E,[s]:x})))}return e.createComponent(qe,{get title(){return n.t("memory.title")},get aside(){return(()=>{var y=Qn();return e.insert(y,()=>n.plural("memory.summary",H(t.data?.blocks).length)),y})()},get children(){return e.createComponent(r.Show,{get when(){return p().length>0},get fallback(){return e.memo(()=>!!t.loading)()?e.createComponent(Ee,{get label(){return n.t("common.loading")}}):e.createComponent(Ae,{get title(){return n.t("memory.empty.title")},get body(){return n.t("memory.empty.body")}})},get children(){var y=Wn();return e.insert(y,e.createComponent(r.For,{get each(){return p()},children:(s,$)=>{const h=()=>vt(s),x=()=>`cdt-memory-content-${$()}`,E=()=>t.scopeKey===d?l()[h()]:null;return(()=>{var N=Xn(),C=N.firstChild,I=C.firstChild,M=I.firstChild,O=M.nextSibling,te=O.firstChild,J=I.nextSibling,B=J.firstChild,q=B.firstChild,K=B.nextSibling,se=K.nextSibling,X=se.firstChild,W=se.nextSibling,ae=W.nextSibling,pe=J.nextSibling,ge=pe.firstChild;ge.firstChild;var me=ge.nextSibling,_e=me.nextSibling;_e.firstChild;var he=pe.nextSibling;he.firstChild;var be=he.nextSibling;return C.$$click=()=>{v(s)},e.insert(M,()=>w(s.label,n.t("common.unknown"))),e.insert(te,()=>n.t("memory.version",{version:w(s.version,"0")})),e.insert(O,e.createComponent(ye,{get tone(){return Pe(s.status)},get label(){return w(s.status,n.t("common.unknown"))}}),null),e.insert(B,()=>n.t("memory.scope"),q),e.insert(B,()=>w(s.scope,n.t("common.unknown")),null),e.insert(se,()=>n.t("memory.confidence"),X),e.insert(se,()=>an(s.confidence),null),e.insert(ae,(()=>{var G=e.memo(()=>typeof s.reviewAfter=="string");return()=>G()?n.t("memory.reviewAfter",{when:rn(s.reviewAfter)}):n.t("memory.noReview")})()),e.insert(ge,(()=>{var G=e.memo(()=>s.review?.classification==="unreviewed");return()=>G()?"unreviewed (pending promotion)":w(s.review?.classification,"unknown")})(),null),e.insert(_e,(()=>{var G=e.memo(()=>typeof s.review?.eligible=="boolean");return()=>G()?s.review.eligible?"yes":"no":"unknown"})(),null),e.insert(he,()=>w(s.sourceRunId,"unknown"),null),e.insert(C,e.createComponent(r.Show,{get when(){return H(s.review?.reasons).length},get children(){var G=Kn();return G.firstChild,e.insert(G,()=>H(s.review?.reasons).join(", "),null),G}}),be),e.insert(C,e.createComponent(r.Show,{get when(){return s.contentPreview},get children(){var G=Yn();return e.insert(G,()=>Ge(s.contentPreview,160)),G}}),be),e.insert(be,(()=>{var G=e.memo(()=>a()===h());return()=>G()?n.t("memory.collapse"):n.t("memory.expand")})()),e.insert(N,e.createComponent(r.Show,{get when(){return e.memo(()=>t.scopeKey===d)()&&a()===h()},get children(){var G=Zn();return e.insert(G,e.createComponent(r.Show,{get when(){return!g()[h()]},get fallback(){return(()=>{var c=bt();return e.insert(c,()=>n.t("memory.loading")),c})()},get children(){return e.createComponent(r.Show,{get when(){return E()},get fallback(){return(()=>{var c=bt();return e.insert(c,()=>n.t("memory.contentUnavailable")),c})()},children:c=>[(()=>{var S=nr(),k=S.firstChild,P=k.firstChild;P.nextSibling;var Y=k.nextSibling,f=Y.firstChild;f.nextSibling;var R=Y.nextSibling,L=R.firstChild;L.nextSibling;var Q=R.nextSibling,V=Q.firstChild;V.nextSibling;var D=Q.nextSibling,z=D.firstChild;z.nextSibling;var oe=D.nextSibling,A=oe.firstChild,re=A.nextSibling,Z=re.nextSibling,ve=Z.nextSibling,$e=ve.nextSibling;return $e.nextSibling,e.insert(k,(()=>{var le=e.memo(()=>c().review?.classification==="unreviewed");return()=>le()?"unreviewed (pending promotion)":w(c().review?.classification??s.review?.classification,"unknown")})(),null),e.insert(Y,(()=>{var le=e.memo(()=>typeof(c().review??s.review)?.eligible=="boolean");return()=>le()?(c().review??s.review)?.eligible?"eligible":"not eligible":"unknown"})(),null),e.insert(R,(()=>{var le=e.memo(()=>(c().review??s.review)?.action==="propose_review");return()=>le()?"propose review":w((c().review??s.review)?.action,"unknown")})(),null),e.insert(S,e.createComponent(r.Show,{get when(){return H((c().review??s.review)?.reasons).length},get children(){var le=er(),ne=le.firstChild;return ne.nextSibling,e.insert(le,()=>H((c().review??s.review)?.reasons).join(", "),null),le}}),Q),e.insert(Q,()=>w(c().sourceRunId,"unknown"),null),e.insert(D,()=>H(c().sourceArtifacts).join(", ")||"unknown",null),e.insert(oe,()=>w(c().actor,"unknown"),Z),e.insert(oe,()=>w(c().contentHash,"unknown"),null),e.insert(S,e.createComponent(r.Show,{get when(){return c().supersedes},get children(){var le=tr(),ne=le.firstChild;return ne.nextSibling,e.insert(le,()=>c().supersedes,null),le}}),null),S})(),(()=>{var S=rr();return e.insert(S,()=>c().content),e.effect(()=>e.setAttribute(S,"aria-label",c().label)),S})()]})}})),e.effect(()=>e.setAttribute(G,"id",x())),G}}),null),e.effect(G=>{var c=a()===h(),S=x();return c!==G.e&&e.setAttribute(C,"aria-expanded",G.e=c),S!==G.t&&e.setAttribute(C,"aria-controls",G.t=S),G},{e:void 0,t:void 0}),N})()}})),y}})}})}e.delegateEvents(["click"]);var $t=e.template("<dt>"),or=e.template("<dd>"),lr=e.template("<dd class=cdt-mono>"),sr=e.template("<dl class=cdt-kv><dt></dt><dd>"),Qe=e.template("<span class=cdt-label>"),it=e.template("<ul class=cdt-list>"),dr=e.template("<pre class=cdt-pre tabindex=0>"),Ke=e.template('<p class="cdt-muted cdt-meta">'),wt=e.template('<li class="cdt-card cdt-card-tight">'),cr=e.template("<li class=cdt-qa><div class=cdt-qa-question><span class=cdt-muted>: </span></div><p class=cdt-qa-answer><span class=cdt-muted>: ");function ur(t){const n=Se.usePlugin(),a=()=>w(t.data?.state,n.t("common.unknown")),i=()=>H(t.data?.uncertainties),l=()=>H(t.data?.qaPairs).filter(o=>w(o.question,"").length>0||w(o.answer,"").length>0),m=()=>Mt(t.data?.contract),g=()=>w(t.data?.requirementsMarkdown,"");return e.createComponent(qe,{get title(){return n.t("refinements.title")},get aside(){return e.createComponent(ye,{get tone(){return Pe(t.data?.state)},get label(){return a()}})},get children(){return e.createComponent(r.Show,{get when(){return t.hasRun},get fallback(){return e.createComponent(Ae,{get title(){return n.t("runs.noSelection")},get body(){return n.t("runs.empty.noSelection")}})},get children(){return e.createComponent(r.Show,{get when(){return t.data},get fallback(){return e.memo(()=>!!t.loading)()?e.createComponent(Ee,{get label(){return n.t("common.loading")}}):null},get children(){return[e.createComponent(r.Show,{get when(){return t.data?.state!=="none"},get children(){var o=sr(),u=o.firstChild,b=u.nextSibling;return e.insert(u,()=>n.t("refinements.state")),e.insert(b,a),e.insert(o,e.createComponent(r.Show,{get when(){return t.data?.outcome},get children(){return[(()=>{var d=$t();return e.insert(d,()=>n.t("refinements.outcome")),d})(),(()=>{var d=or();return e.insert(d,()=>w(t.data?.outcome,n.t("common.unknown"))),d})()]}}),null),e.insert(o,e.createComponent(r.Show,{get when(){return t.data?.requirementsPath},get children(){return[(()=>{var d=$t();return e.insert(d,()=>n.t("refinements.source")),d})(),(()=>{var d=lr();return e.insert(d,()=>w(t.data?.requirementsPath,"")),d})()]}}),null),o}}),e.createComponent(r.Show,{get when(){return i().length>0},get fallback(){return(()=>{var o=Ke();return e.insert(o,()=>n.t("refinements.noUncertainties")),o})()},get children(){return[(()=>{var o=Qe();return e.insert(o,()=>n.t("refinements.uncertainties")),o})(),(()=>{var o=it();return e.insert(o,e.createComponent(r.For,{get each(){return i()},children:u=>(()=>{var b=wt();return e.insert(b,u),b})()})),o})()]}}),(()=>{var o=Qe();return e.insert(o,()=>n.t("refinements.qa")),o})(),e.createComponent(r.Show,{get when(){return l().length>0},get fallback(){return(()=>{var o=Ke();return e.insert(o,()=>n.t("refinements.noQa")),o})()},get children(){var o=it();return e.insert(o,e.createComponent(r.For,{get each(){return l()},children:u=>(()=>{var b=cr(),d=b.firstChild,p=d.firstChild,v=p.firstChild,y=d.nextSibling,s=y.firstChild,$=s.firstChild;return e.insert(p,()=>n.t("refinements.question"),v),e.insert(d,()=>w(u.question,n.t("common.unknown")),null),e.insert(s,()=>n.t("refinements.answer"),$),e.insert(y,()=>w(u.answer,n.t("common.unknown")),null),b})()})),o}}),(()=>{var o=Qe();return e.insert(o,()=>n.t("refinements.openQuestions")),o})(),e.createComponent(r.Show,{get when(){return m().length>0},get fallback(){return(()=>{var o=Ke();return e.insert(o,()=>n.t("refinements.noOpenQuestions")),o})()},get children(){var o=it();return e.insert(o,e.createComponent(r.For,{get each(){return m()},children:u=>(()=>{var b=wt();return e.insert(b,u),b})()})),o}}),(()=>{var o=Qe();return e.insert(o,()=>n.t("refinements.requirements")),o})(),e.createComponent(r.Show,{get when(){return g().length>0},get fallback(){return(()=>{var o=Ke();return e.insert(o,()=>n.t("refinements.noRequirements")),o})()},get children(){var o=dr();return e.insert(o,g),e.effect(()=>e.setAttribute(o,"aria-label",n.t("refinements.requirements"))),o}})]}})}})}})}var pr=e.template("<span class=cdt-muted>"),at=e.template("<ul class=cdt-list>"),xt=e.template("<section class=cdt-section><h3 class=cdt-heading>"),gr=e.template("<section class=cdt-section><h3 class=cdt-heading></h3><dl class=cdt-kv><dt></dt><dd></dd><dt></dt><dd></dd><dt></dt><dd>"),mr=e.template("<ol class=cdt-list>"),hr=e.template('<section class=cdt-section><div class="cdt-row cdt-between"><h3 class=cdt-heading>'),ot=e.template('<p class="cdt-muted cdt-meta">'),fr=e.template('<li class="cdt-card cdt-card-tight"><div class="cdt-row cdt-between cdt-gap"><span class=cdt-strong></span></div><div class="cdt-mono cdt-meta cdt-muted"></div><div class="cdt-meta cdt-muted">: '),br=e.template("<span aria-hidden=true>&middot;"),vr=e.template("<span>"),$r=e.template('<li class="cdt-card cdt-card-tight"><div class="cdt-row cdt-between cdt-gap"><span class=cdt-strong></span><span class="cdt-muted cdt-meta"></span></div><div class="cdt-mono cdt-meta cdt-muted">/</div><div class="cdt-row cdt-wrap cdt-meta cdt-muted"><span></span><span aria-hidden=true>&middot;</span><span> completed</span><span aria-hidden=true>&middot;</span><span> failed'),wr=e.template('<li class="cdt-card cdt-card-tight"><div class="cdt-row cdt-between cdt-gap"><span class="cdt-mono cdt-strong"></span><span class="cdt-muted cdt-meta"></span></div><div class="cdt-row cdt-wrap cdt-meta cdt-muted"><span>: </span><span aria-hidden=true>&middot;</span><span>: '),_t=e.template("<span class=cdt-mono>"),xr=e.template("<p class=cdt-event-summary>"),_r=e.template('<li class=cdt-event><span class=cdt-event-seq aria-hidden=true></span><div class=cdt-event-body><div class="cdt-row cdt-between cdt-gap"><span class="cdt-strong cdt-mono"></span><time class="cdt-muted cdt-meta"></time></div><div class="cdt-meta cdt-muted">');const yr=120;function Sr(t){const n=Se.usePlugin(),a=()=>H(t.data?.assignments),i=()=>H(t.data?.observed),l=()=>H(t.data?.costs.byModel),m=r.createMemo(()=>H(t.timeline?.events).slice().sort((o,u)=>u.sequence-o.sequence).slice(0,yr)),g=()=>(()=>{var o=pr();return e.insert(o,()=>n.t("routing.usageUnavailable")),o})();return e.createComponent(qe,{get title(){return n.t("routing.title")},get children(){return e.createComponent(r.Show,{get when(){return t.hasRun},get fallback(){return e.createComponent(Ae,{get title(){return n.t("runs.noSelection")},get body(){return n.t("runs.empty.noSelection")}})},get children(){return e.createComponent(r.Show,{get when(){return t.data},get fallback(){return e.memo(()=>!!t.loading)()?e.createComponent(Ee,{get label(){return n.t("common.loading")}}):e.createComponent(Ae,{get title(){return n.t("routing.empty.title")},get body(){return n.t("routing.empty.body")}})},get children(){return[(()=>{var o=xt(),u=o.firstChild;return e.insert(u,()=>n.t("routing.assignments")),e.insert(o,e.createComponent(r.Show,{get when(){return a().length>0},get fallback(){return(()=>{var b=ot();return e.insert(b,()=>n.t("routing.noAssignments")),b})()},get children(){var b=at();return e.insert(b,e.createComponent(r.For,{get each(){return a()},children:d=>(()=>{var p=fr(),v=p.firstChild,y=v.firstChild,s=v.nextSibling,$=s.nextSibling,h=$.firstChild;return e.insert(y,()=>w(d.role,n.t("common.unknown"))),e.insert(v,e.createComponent(r.Show,{get when(){return d.variant},get children(){return e.createComponent(ye,{tone:"pending",get label(){return w(d.variant,"")}})}}),null),e.insert(s,()=>w(d.model,n.t("common.unknown"))),e.insert($,()=>n.t("routing.source"),h),e.insert($,()=>w(d.source,n.t("common.unknown")),null),p})()})),b}}),null),e.effect(()=>e.setAttribute(o,"aria-label",n.t("routing.assignments"))),o})(),(()=>{var o=xt(),u=o.firstChild;return e.insert(u,()=>n.t("routing.observed")),e.insert(o,e.createComponent(r.Show,{get when(){return i().length>0},get fallback(){return(()=>{var b=ot();return e.insert(b,()=>n.t("routing.noObserved")),b})()},get children(){var b=at();return e.insert(b,e.createComponent(r.For,{get each(){return i()},children:d=>(()=>{var p=$r(),v=p.firstChild,y=v.firstChild,s=y.nextSibling,$=v.nextSibling,h=$.firstChild,x=$.nextSibling,E=x.firstChild,N=E.nextSibling,C=N.nextSibling,I=C.firstChild,M=C.nextSibling,O=M.nextSibling,te=O.firstChild;return e.insert(y,()=>w(d.role,n.t("common.unknown"))),e.insert(s,()=>n.t("routing.attempts",{count:w(d.attempts,"0")})),e.insert($,()=>w(d.modelProvider,n.t("common.unknown")),h),e.insert($,()=>w(d.modelId,n.t("common.unknown")),null),e.insert($,e.createComponent(r.Show,{get when(){return d.modelVariant},get children(){return["/",e.memo(()=>w(d.modelVariant,""))]}}),null),e.insert(E,()=>w(d.modelSlot,n.t("common.unknown"))),e.insert(C,()=>w(d.completed,"0"),I),e.insert(O,()=>w(d.failed,"0"),te),e.insert(x,e.createComponent(r.Show,{get when(){return typeof d.avgDurationMs=="number"},get children(){return[br(),(()=>{var J=vr();return e.insert(J,()=>n.t("routing.avgDuration",{duration:jt(d.avgDurationMs)})),J})()]}}),null),p})()})),b}}),null),e.effect(()=>e.setAttribute(o,"aria-label",n.t("routing.observed"))),o})(),(()=>{var o=gr(),u=o.firstChild,b=u.nextSibling,d=b.firstChild,p=d.nextSibling,v=p.nextSibling,y=v.nextSibling,s=y.nextSibling,$=s.nextSibling;return e.insert(u,()=>n.t("routing.costs")),e.insert(d,()=>n.t("routing.totalTokens")),e.insert(p,()=>ut(t.data?.costs.totalTokens)??g()),e.insert(v,()=>n.t("routing.totalCost")),e.insert(y,()=>pt(t.data?.costs.totalCost,t.data?.costs.currency)??g()),e.insert(s,()=>n.t("routing.coverage")),e.insert($,()=>n.t("routing.coverageValue",{withUsage:w(t.data?.costs.coverage.withUsage,"0"),attempts:w(t.data?.costs.coverage.attempts,"0")})),e.insert(o,e.createComponent(r.Show,{get when(){return l().length>0},get children(){var h=at();return e.insert(h,e.createComponent(r.For,{get each(){return l()},children:x=>(()=>{var E=wr(),N=E.firstChild,C=N.firstChild,I=C.nextSibling,M=N.nextSibling,O=M.firstChild,te=O.firstChild,J=O.nextSibling,B=J.nextSibling,q=B.firstChild;return e.insert(C,()=>w(x.model,n.t("common.unknown"))),e.insert(I,()=>n.t("routing.attempts",{count:w(x.attempts,"0")})),e.insert(O,()=>n.t("routing.totalTokens"),te),e.insert(O,()=>ut(x.tokens)??g(),null),e.insert(B,()=>n.t("routing.totalCost"),q),e.insert(B,()=>pt(x.cost,x.currency??t.data?.costs.currency)??g(),null),E})()})),h}}),null),e.effect(()=>e.setAttribute(o,"aria-label",n.t("routing.costs"))),o})(),(()=>{var o=hr(),u=o.firstChild,b=u.firstChild;return e.insert(b,()=>n.t("routing.timeline")),e.insert(u,e.createComponent(r.Show,{get when(){return t.timeline?.truncated},get children(){return e.createComponent(ye,{tone:"pending",get label(){return n.t("routing.truncated")}})}}),null),e.insert(o,e.createComponent(r.Show,{get when(){return m().length>0},get fallback(){return(()=>{var d=ot();return e.insert(d,()=>n.t("routing.noEvents")),d})()},get children(){var d=mr();return e.insert(d,e.createComponent(r.For,{get each(){return m()},children:p=>(()=>{var v=_r(),y=v.firstChild,s=y.nextSibling,$=s.firstChild,h=$.firstChild,x=h.nextSibling,E=$.nextSibling;return e.insert(y,()=>p.sequence),e.insert(h,()=>w(p.type,n.t("common.unknown"))),e.insert(x,()=>Ye(p.createdAt)),e.insert(E,()=>w(p.actor,n.t("common.unknown")),null),e.insert(E,e.createComponent(r.Show,{get when(){return p.taskId},get children(){return[" · ",(()=>{var N=_t();return e.insert(N,()=>p.taskId),N})()]}}),null),e.insert(E,e.createComponent(r.Show,{get when(){return p.attemptId},get children(){return[" · ",(()=>{var N=_t();return e.insert(N,()=>Ge(p.attemptId,18)),N})()]}}),null),e.insert(s,e.createComponent(r.Show,{get when(){return p.summary},get children(){var N=xr();return e.insert(N,()=>Ge(p.summary,240)),N}}),null),e.effect(()=>e.setAttribute(x,"datetime",w(p.createdAt,""))),v})()})),d}}),null),e.effect(()=>e.setAttribute(o,"aria-label",n.t("routing.timeline"))),o})()]}})}})}})}var Cr=e.template('<div class=cdt-run-counts aria-label="Project run counts"><span><strong></strong> active</span><span><strong></strong> total</span><span><strong></strong> tasks'),kr=e.template('<div class=cdt-run-toolbar><div class=cdt-run-switch role=group aria-label="Run category"><button type=button>Active</button><button type=button>History</button></div><label>Search loaded runs <input type=search></label><label>Sort <select><option value=newest>Newest updated</option><option value=oldest>Oldest updated</option><option value=objective>Objective'),Ar=e.template('<p class="cdt-muted cdt-meta">Showing <!> of <!> loaded runs. Search and sort apply to loaded runs only.'),Mr=e.template("<div class=cdt-table-scroll><table class=cdt-run-table><thead><tr><th scope=col>Objective</th><th scope=col>State</th><th scope=col>Tasks</th><th scope=col>Attention</th><th scope=col>Updated</th></tr></thead><tbody>"),Nr=e.template("<button class=cdt-more type=button>"),Rr=e.template('<tr><td><button class=cdt-run-link type=button></button><div class="cdt-mono cdt-muted cdt-meta"></div></td><td></td><td>/</td><td></td><td>');function jr(t){const n=Se.usePlugin(),[a,i]=r.createSignal(!0),[l,m]=r.createSignal(""),[g,o]=r.createSignal("newest"),u=r.createMemo(()=>Jt(t.runs,a(),l(),g())),b=r.createMemo(()=>t.runs.filter(Nt).length);return e.createComponent(qe,{get title(){return n.t("runs.title")},get children(){return[(()=>{var d=Cr(),p=d.firstChild,v=p.firstChild;v.nextSibling;var y=p.nextSibling,s=y.firstChild;s.nextSibling;var $=y.nextSibling,h=$.firstChild;return e.insert(v,()=>t.workspace?.counts.activeRuns??b()),e.insert(p,()=>!t.workspace&&" loaded",null),e.insert(s,()=>t.workspace?.counts.runs??t.runs.length),e.insert(y,()=>!t.workspace&&" loaded",null),e.insert(h,()=>t.workspace?.counts.tasks??"—"),d})(),(()=>{var d=kr(),p=d.firstChild,v=p.firstChild,y=v.nextSibling,s=p.nextSibling,$=s.firstChild,h=$.nextSibling,x=s.nextSibling,E=x.firstChild,N=E.nextSibling;return v.$$click=()=>i(!0),y.$$click=()=>i(!1),h.$$input=C=>m(C.currentTarget.value),N.addEventListener("change",C=>o(C.currentTarget.value)),e.effect(C=>{var I=a(),M=!a();return I!==C.e&&e.setAttribute(v,"aria-pressed",C.e=I),M!==C.t&&e.setAttribute(y,"aria-pressed",C.t=M),C},{e:void 0,t:void 0}),e.effect(()=>h.value=l()),e.effect(()=>N.value=g()),d})(),(()=>{var d=Ar(),p=d.firstChild,v=p.nextSibling,y=v.nextSibling,s=y.nextSibling;return s.nextSibling,e.insert(d,()=>u().length,v),e.insert(d,()=>t.runs.length,s),d})(),e.createComponent(r.Show,{get when(){return!t.loading||t.runs.length},get fallback(){return e.createComponent(Ee,{get label(){return n.t("common.loading")}})},get children(){return[e.createComponent(r.Show,{get when(){return u().length},get fallback(){return e.createComponent(Ae,{get title(){return e.memo(()=>!!t.runs.length)()?"No matching loaded runs":n.t("runs.empty.title")},get body(){return e.memo(()=>!!t.runs.length)()?"Try another filter or load more runs.":n.t("runs.empty.body")}})},get children(){var d=Mr(),p=d.firstChild,v=p.firstChild,y=v.nextSibling;return e.insert(y,e.createComponent(r.For,{get each(){return u()},children:s=>{const $=()=>Pt(At(s.counts),s.taskCount);return(()=>{var h=Rr(),x=h.firstChild,E=x.firstChild,N=E.nextSibling,C=x.nextSibling,I=C.nextSibling,M=I.firstChild,O=I.nextSibling,te=O.nextSibling;return E.$$click=()=>t.onSelect(s.id),e.insert(E,()=>s.objective||s.id),e.insert(N,()=>s.id),e.insert(C,e.createComponent(ye,{get tone(){return Pe(s.state)},get label(){return s.state}})),e.insert(I,()=>$().completed,M),e.insert(I,()=>$().total,null),e.insert(O,()=>Wt(s)),e.insert(te,()=>nn(s.updatedAt)),e.effect(()=>e.setAttribute(E,"aria-label",`Open run: ${s.objective||s.id}`)),h})()}})),d}}),e.createComponent(r.Show,{get when(){return t.nextCursor},get children(){var d=Nr();return e.addEventListener(d,"click",t.onMore,!0),e.insert(d,()=>t.loadingMore?"Loading…":"Load more runs"),e.effect(()=>d.disabled=t.loadingMore),d}})]}})]}})}e.delegateEvents(["click","input"]);const Pr=/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/,Er=/^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/;function qr(t){const n=[],{model:a,variant:i,steps:l,permissions:m}=t.values;a&&(!Er.test(a)||a.split("/").some(g=>!g||g==="."||g===".."))&&n.push("Model must be a provider/model reference."),i&&!Pr.test(i)&&n.push("Variant contains invalid characters."),l&&(!/^[1-9]\d*$/.test(l)||!Number.isSafeInteger(Number(l))||Number(l)>1e4)&&n.push("Steps must be a positive whole number.");try{const g=JSON.parse(m);Array.isArray(g)?g.some(o=>!o||typeof o.action!="string"||typeof o.resource!="string"||!o.resource.trim()||o.resource.length>256||!["allow","ask","deny"].includes(o.effect))&&n.push("Each permission needs an action, a resource and a valid effect."):n.push("Permissions must be a JSON array.")}catch{n.push("Permissions must be a valid JSON array.")}return n}function yt(t,n,a){return!Number.isInteger(n)||n<0||n>=t.length||t[n].action!=="skill"?[...t]:a===null?t.filter((i,l)=>l!==n):t.map((i,l)=>l===n?{...i,...a}:i)}var Ir=e.template('<p class="cdt-muted cdt-meta">Effective snapshot. Model slots used by tasks are routing roles, not necessarily the actual model used by an attempt.'),Tr=e.template('<p class="cdt-muted cdt-meta">'),Fr=e.template("<div class=cdt-inspector-layout><nav class=cdt-inspector-nav aria-label=Agents>"),Or=e.template("<section class=cdt-section><h3 class=cdt-heading>Skills</h3><p>"),Lr=e.template(`<details class=cdt-inspector-disclosure><summary>Native configuration examples</summary><p class=cdt-muted>Examples only. Use the editor above to save an override; replace placeholder values when using these examples elsewhere.</p><h4 class=cdt-subheading>Agent Markdown · .opencode/agents/example.md</h4><pre class=cdt-pre tabindex=0>---
description: Example agent
mode: subagent
model: provider/model#variant
steps: 20
---
Your system instructions here.</pre><h4 class=cdt-subheading>JSONC · opencode.jsonc</h4><pre class=cdt-pre tabindex=0>{
  "$schema": "https://opencode.ai/config.json",
  "agents": {
    "example": {
      "description": "Example agent",
      "mode": "subagent",
      "system": "Your system instructions here.",
      "model": "provider/model#variant",
      "steps": 20
    }
  }
}`),st=e.template("<p class=cdt-inspector-note>"),Et=e.template("<button type=button>"),Dr=e.template("<div class=cdt-inspector-detail><h3 class=cdt-subheading></h3><div class=cdt-inspector-scroll><table class=cdt-inspector-table><caption class=cdt-sr-only>Agent configuration fields and sources</caption><thead><tr><th scope=col>Field</th><th scope=col>Value</th><th scope=col>Source</th></tr></thead><tbody><tr><th scope=row>Description</th><td></td><td></td></tr><tr><th scope=row>Mode</th><td></td><td></td></tr><tr><th scope=row>Model</th><td></td><td></td></tr><tr><th scope=row>Variant</th><td></td><td></td></tr><tr><th scope=row>Steps</th><td></td><td></td></tr><tr><th scope=row>System prompt</th><td>See disclosure below</td><td></td></tr><tr><th scope=row>Permissions</th><td>See disclosure below</td><td></td></tr></tbody></table></div><details class=cdt-inspector-disclosure><summary>System prompt</summary><pre class=cdt-pre tabindex=0></pre></details><details class=cdt-inspector-disclosure><summary>Permissions JSON</summary><pre class=cdt-pre tabindex=0>"),zr=e.template("<p class=cdt-inspector-note>Native configuration editing is unavailable."),Ur=e.template("<p class=cdt-inspector-note role=status>Unsaved agent changes are retained in this panel."),Gr=e.template("<p role=status>Loading target…"),Vr=e.template("<p class=cdt-inspector-note role=status>"),Br=e.template('<section class=cdt-agent-draft><h4 class=cdt-subheading>Edit native override</h4><p class="cdt-muted cdt-meta">Drafts remain available when switching agents, scopes and tabs. Save checks the target revision.</p><div class="cdt-row cdt-wrap"><label>Scope <select><option value=project>Project</option><option value=global>Global</option></select></label><button type=button>'),Hr=e.template('<p class="cdt-muted cdt-meta">Target: <!> · Revision: <span class=cdt-mono>'),Jr=e.template('<fieldset class=cdt-editor-fieldset><div class=cdt-draft-fields><label>Model <input placeholder=provider/model><datalist></datalist></label><label>Variant <input><datalist></datalist></label><label>Steps <input type=number min=1 max=10000 step=1></label><label>System prompt <textarea rows=5></textarea></label></div><h5 class=cdt-subheading>Skill permissions</h5><p class="cdt-muted cdt-meta">Rules are evaluated in order; the last matching rule wins. These permissions do not attach skills. Other permission rules are preserved.</p><button type=button>Add skill rule'),St=e.template("<option>"),Wr=e.template("<div class=cdt-skill-rule><label>Skill ID or pattern <input></label><label>Effect <select><option value=ask>Ask</option><option value=allow>Allow</option><option value=deny>Deny</option></select></label><button type=button>Remove");function Qr(t){const n=Se.usePlugin(),[a,i]=r.createSignal(null),[l,m]=r.createSignal(!1);r.createEffect(()=>t.onDirty?.(l())),r.onCleanup(()=>t.onDirty?.(!1));const g=()=>H(t.data?.agents),o=r.createMemo(()=>g().find(b=>b.id===a())??g()[0]??null),u=(b,d)=>w(At(b.sources)[d],"unknown");return e.createComponent(qe,{title:"Configuration",get children(){return e.createComponent(r.Show,{get when(){return t.data},get fallback(){return e.memo(()=>!!t.loading)()?e.createComponent(Ee,{get label(){return n.t("common.loading")}}):e.createComponent(Ae,{title:"Configuration unavailable"})},get children(){return[Ir(),(()=>{var b=Tr();return e.insert(b,()=>t.data?.nativeResolved?"Native values are resolved by the host; the contributing configuration files are not exposed.":"Native resolution unavailable. Packaged defaults are not asserted to be effective host configuration."),b})(),e.createComponent(r.For,{get each(){return H(t.data?.warnings)},children:b=>(()=>{var d=st();return e.insert(d,b),d})()}),e.createComponent(r.Show,{get when(){return g().length},get fallback(){return e.createComponent(Ae,{title:"No agents available",body:"No agent configuration was returned."})},get children(){var b=Fr(),d=b.firstChild;return e.insert(d,e.createComponent(r.For,{get each(){return g()},children:p=>(()=>{var v=Et();return v.$$click=()=>i(p.id),e.insert(v,()=>p.id),e.effect(()=>e.setAttribute(v,"aria-pressed",o()?.id===p.id)),v})()})),e.insert(b,e.createComponent(r.Show,{get when(){return o()},children:p=>(()=>{var v=Dr(),y=v.firstChild,s=y.nextSibling,$=s.firstChild,h=$.firstChild,x=h.nextSibling,E=x.nextSibling,N=E.firstChild,C=N.firstChild,I=C.nextSibling,M=I.nextSibling,O=N.nextSibling,te=O.firstChild,J=te.nextSibling,B=J.nextSibling,q=O.nextSibling,K=q.firstChild,se=K.nextSibling,X=se.nextSibling,W=q.nextSibling,ae=W.firstChild,pe=ae.nextSibling,ge=pe.nextSibling,me=W.nextSibling,_e=me.firstChild,he=_e.nextSibling,be=he.nextSibling,G=me.nextSibling,c=G.firstChild,S=c.nextSibling,k=S.nextSibling,P=G.nextSibling,Y=P.firstChild,f=Y.nextSibling,R=f.nextSibling,L=s.nextSibling,Q=L.firstChild,V=Q.nextSibling,D=L.nextSibling,z=D.firstChild,oe=z.nextSibling;return e.insert(y,()=>p().id),e.insert(v,e.createComponent(r.For,{get each(){return H(p().warnings)},children:A=>(()=>{var re=st();return e.insert(re,A),re})()}),s),e.insert(I,()=>w(p().description,"Not provided")),e.insert(M,()=>u(p(),"description")),e.insert(J,()=>w(p().mode,"Not provided")),e.insert(B,()=>u(p(),"mode")),e.insert(se,()=>w(p().model,"Not provided")),e.insert(X,()=>u(p(),"model")),e.insert(pe,()=>w(p().variant,"Not provided")),e.insert(ge,()=>u(p(),"variant")),e.insert(he,()=>w(p().steps,"Not provided")),e.insert(be,()=>u(p(),"steps")),e.insert(k,()=>u(p(),"system")),e.insert(R,()=>u(p(),"permissions")),e.insert(V,()=>w(p().system,"Not provided")),e.insert(oe,()=>JSON.stringify(H(p().permissions),null,2)),e.insert(v,e.createComponent(r.Show,{get when(){return t.editor},get fallback(){return zr()},children:A=>e.createComponent(Kr,{get agentId(){return p().id},get editor(){return A()},get models(){return t.data?.models},onDirty:m})}),null),v})()}),null),b}}),(()=>{var b=Or(),d=b.firstChild,p=d.nextSibling;return e.insert(p,()=>w(t.data?.skillPolicy,"Skill policy unavailable.")),b})(),Lr()]}})}})}function Kr(t){const n=`cdt-models-${r.createUniqueId()}`,a=`cdt-variants-${r.createUniqueId()}`,[i,l]=r.createSignal("project"),[m,g]=r.createSignal({}),[o,u]=r.createSignal(!1),[b,d]=r.createSignal(""),p=()=>`${i()}:${t.agentId}`,v=()=>m()[p()],y=M=>JSON.stringify(M.document.values)!==M.baseline,s=()=>!!v()&&y(v());r.createEffect(()=>t.onDirty(Object.values(m()).some(y)));let $=0;r.onCleanup(()=>{$++});async function h(){const M=t.agentId,O=i(),te=p(),J=m()[te];if(J&&y(J)&&!window.confirm("Discard this unsaved draft and reload the target?"))return;const B=++$;u(!0),d("");try{const q=await t.editor.load(M,O);if(B!==$)return;g(K=>({...K,[te]:{document:q,baseline:JSON.stringify(q.values)}}))}catch(q){B===$&&d(q instanceof Error?q.message:String(q))}finally{B===$&&u(!1)}}function x(M,O){const te=p();g(J=>{const B=J[te];return B?{...J,[te]:{...B,document:{...B.document,values:{...B.document.values,[M]:O}}}}:J}),d("")}async function E(){const M=v(),O=t.agentId,te=i(),J=p();if(!M||o())return;const B=qr(M.document);if(B.length){d(B.join(" "));return}if(te==="global"&&!window.confirm(`Save global configuration for ${O}? This affects other projects.`))return;const q=++$;u(!0),d("");try{const K=await t.editor.save(O,te,M.document);if(q!==$)return;g(se=>({...se,[J]:{document:K,baseline:JSON.stringify(K.values)}})),d("Saved.")}catch(K){q===$&&d(`Save failed: ${K instanceof Error?K.message:String(K)}. Your draft was retained.`)}finally{q===$&&u(!1)}}const N=()=>{try{return JSON.parse(v()?.document.values.permissions??"[]")}catch{return[]}},C=()=>N().map((M,O)=>({rule:M,index:O})).filter(M=>M.rule.action==="skill"),I=(M,O)=>x("permissions",JSON.stringify(yt(N(),M,O),null,2));return(()=>{var M=Br(),O=M.firstChild,te=O.nextSibling,J=te.nextSibling,B=J.firstChild,q=B.firstChild,K=q.nextSibling,se=B.nextSibling;return e.insert(M,e.createComponent(r.Show,{get when(){return Object.values(m()).some(y)},get children(){return Ur()}}),J),K.addEventListener("change",X=>{l(X.currentTarget.value),d("")}),se.$$click=()=>{h()},e.insert(se,()=>v()?"Reload target":"Load target"),e.insert(M,e.createComponent(r.Show,{get when(){return v()},children:X=>[(()=>{var W=Hr(),ae=W.firstChild,pe=ae.nextSibling,ge=pe.nextSibling,me=ge.nextSibling;return e.insert(W,()=>X().document.target,pe),e.insert(me,()=>X().document.revision),W})(),e.createComponent(r.For,{get each(){return X().document.warnings??[]},children:W=>(()=>{var ae=st();return e.insert(ae,W),ae})()}),(()=>{var W=Jr(),ae=W.firstChild,pe=ae.firstChild,ge=pe.firstChild,me=ge.nextSibling,_e=me.nextSibling,he=pe.nextSibling,be=he.firstChild,G=be.nextSibling,c=G.nextSibling,S=he.nextSibling,k=S.firstChild,P=k.nextSibling,Y=S.nextSibling,f=Y.firstChild,R=f.nextSibling,L=ae.nextSibling,Q=L.nextSibling,V=Q.nextSibling;return me.$$input=D=>x("model",D.currentTarget.value),e.setAttribute(me,"list",n),e.setAttribute(_e,"id",n),e.insert(_e,e.createComponent(r.For,{get each(){return H(t.models)},children:D=>(()=>{var z=St();return e.insert(z,()=>D.name),e.effect(()=>z.value=D.id),z})()})),G.$$input=D=>x("variant",D.currentTarget.value),e.setAttribute(G,"list",a),e.setAttribute(c,"id",a),e.insert(c,e.createComponent(r.For,{get each(){return H(t.models).find(D=>D.id===X().document.values.model)?.variants??[]},children:D=>(()=>{var z=St();return z.value=D,z})()})),P.$$input=D=>x("steps",D.currentTarget.value),R.$$input=D=>x("system",D.currentTarget.value),e.insert(W,e.createComponent(r.Index,{get each(){return C()},children:D=>(()=>{var z=Wr(),oe=z.firstChild,A=oe.firstChild,re=A.nextSibling,Z=oe.nextSibling,ve=Z.firstChild,$e=ve.nextSibling,le=Z.nextSibling;return re.$$input=ne=>I(D().index,{resource:ne.currentTarget.value}),$e.addEventListener("change",ne=>I(D().index,{effect:ne.currentTarget.value})),le.$$click=()=>x("permissions",JSON.stringify(yt(N(),D().index,null),null,2)),e.effect(()=>e.setAttribute(le,"aria-label",`Remove skill rule ${D().rule.resource}`)),e.effect(()=>re.value=D().rule.resource),e.effect(()=>$e.value=D().rule.effect),z})()}),V),V.$$click=()=>x("permissions",JSON.stringify([...N(),{action:"skill",resource:"",effect:"ask"}],null,2)),e.effect(()=>W.disabled=o()),e.effect(()=>me.value=X().document.values.model),e.effect(()=>G.value=X().document.values.variant),e.effect(()=>P.value=X().document.values.steps),e.effect(()=>R.value=X().document.values.system),W})(),(()=>{var W=Et();return W.$$click=()=>{E()},e.insert(W,()=>o()?"Saving…":"Save override"),e.effect(()=>W.disabled=o()||!s()),W})()]}),null),e.insert(M,e.createComponent(r.Show,{get when(){return e.memo(()=>!!o())()&&!v()},get children(){return Gr()}}),null),e.insert(M,e.createComponent(r.Show,{get when(){return b()},get children(){var X=Vr();return e.insert(X,b),X}}),null),e.effect(X=>{var W=o(),ae=o();return W!==X.e&&(K.disabled=X.e=W),ae!==X.t&&(se.disabled=X.t=ae),X},{e:void 0,t:void 0}),e.effect(()=>K.value=i()),M})()}e.delegateEvents(["click","input"]);var Yr=e.template('<p class="cdt-muted cdt-meta">'),Zr=e.template("<div class=cdt-inspector-scroll><table class=cdt-inspector-table><caption class=cdt-sr-only>Branches and configured policy</caption><tbody><tr><th scope=row>Main branch</th><td></td></tr><tr><th scope=row>Development branch</th><td></td></tr><tr><th scope=row>Repository</th><td></td></tr><tr><th scope=row>Allowed remotes</th><td></td></tr><tr><th scope=row>Allowed targets</th><td></td></tr><tr><th scope=row>Configured operations</th><td></td></tr><tr><th scope=row>Preview providers</th><td></td></tr><tr><th scope=row>Policy source</th><td></td></tr><tr><th scope=row>Policy hash</th><td class=cdt-mono>"),lt=e.template("<ul class=cdt-inspector-list>"),Xr=e.template("<section class=cdt-section><h3 class=cdt-heading>Required checks"),ei=e.template("<section class=cdt-section><h3 class=cdt-heading>Project verification commands"),ti=e.template("<p>"),ni=e.template(`<p class="cdt-muted cdt-meta">The host's own permission policy can still ask or deny. This is not a merge rule, branch-protection check, preview result, or candidate-bound approval.`),ri=e.template("<section class=cdt-section><h3 class=cdt-heading>Current local push guard"),ii=e.template("<section class=cdt-section><h3 class=cdt-heading>Preview awareness"),ai=e.template("<section class=cdt-section><h3 class=cdt-heading>Release gate sequence</h3><ol class=cdt-inspector-sequence><li>Run required checks.</li><li>Obtain approval to merge the worktree into development and push.</li><li>Verify the deployment for the pushed commit and share its preview URL.</li><li>Obtain the user's preview verification.</li><li>Open or report the development-to-main PR.</li></ol><p class=cdt-muted>This sequence is guidance, not evidence that any step has passed or authorization to perform it."),qt=e.template("<p class=cdt-inspector-note>"),oi=e.template("<p class=cdt-muted>No required checks configured in policy."),Ct=e.template("<li><code>"),li=e.template("<p class=cdt-muted>No verification commands provided."),si=e.template("<p class=cdt-muted>Branch names are unknown; no branch-specific promise can be made."),di=e.template("<p class=cdt-muted>Preview configuration is unavailable."),ci=e.template("<p>Provider: <!> · Branch: "),ui=e.template("<p>URL: "),pi=e.template('<p class="cdt-muted cdt-meta">Sources: <!>. Configuration does not establish a connected provider or a verified deployment.'),gi=e.template("<li>"),mi=e.template("<p role=status>Loading settings…"),hi=e.template("<p role=status class=cdt-inspector-note>"),fi=e.template('<section class=cdt-section><h3 class=cdt-heading>Project settings</h3><p class="cdt-muted cdt-meta">Changes affect new runs. Saving checks the target revision; a conflict never overwrites newer settings.</p><button type=button>Load settings'),bi=e.template('<p class="cdt-muted cdt-meta">Target: <!> · Revision: '),vi=e.template('<fieldset class=cdt-editor-fieldset><div class=cdt-draft-fields><label>Main branch<input></label><label>Development branch<input></label><label>Verification commands<textarea rows=4></textarea><span class="cdt-muted cdt-meta">One command per line.</span></label><label>Preview provider<select><option value=none>None</option><option value=vercel>Vercel</option><option value=other>Other</option></select></label><label>Preview URL<input type=url></label><label>Preview branch<input></label><label><span>Memory policy</span><select><option value=enabled>Enabled</option><option value=disabled>Disabled'),$i=e.template('<p class="cdt-muted cdt-meta">A configured preview does not establish a connected provider or a successful deployment.'),wi=e.template("<button type=button>");function xi(t){const n=Se.usePlugin(),a=i=>H(i).filter(l=>typeof l=="string"&&l.length>0);return e.createComponent(qe,{title:"Project policy",get children(){return e.createComponent(r.Show,{get when(){return t.data},get fallback(){return e.memo(()=>!!t.loading)()?e.createComponent(Ee,{get label(){return n.t("common.loading")}}):e.createComponent(Ae,{title:"Project policy unavailable"})},children:i=>[(()=>{var l=Yr();return e.insert(l,()=>w(i().projectRoot,"Project directory unavailable")),l})(),e.createComponent(r.Show,{get when(){return t.editor},children:l=>e.createComponent(_i,{get data(){return i()},get editor(){return l()},onDirty:m=>t.onDirty?.(m)})}),e.createComponent(r.For,{get each(){return H(i().warnings)},children:l=>(()=>{var m=qt();return e.insert(m,l),m})()}),(()=>{var l=Zr(),m=l.firstChild,g=m.firstChild,o=g.nextSibling,u=o.firstChild,b=u.firstChild,d=b.nextSibling,p=u.nextSibling,v=p.firstChild,y=v.nextSibling,s=p.nextSibling,$=s.firstChild,h=$.nextSibling,x=s.nextSibling,E=x.firstChild,N=E.nextSibling,C=x.nextSibling,I=C.firstChild,M=I.nextSibling,O=C.nextSibling,te=O.firstChild,J=te.nextSibling,B=O.nextSibling,q=B.firstChild,K=q.nextSibling,se=B.nextSibling,X=se.firstChild,W=X.nextSibling,ae=se.nextSibling,pe=ae.firstChild,ge=pe.nextSibling;return e.insert(d,()=>w(i().branches?.main,"Unknown")),e.insert(y,()=>w(i().branches?.dev,"Unknown")),e.insert(h,()=>w(i().policy?.repository,"Not configured")),e.insert(N,()=>a(i().policy?.remotes).join(", ")||"Not configured"),e.insert(M,()=>a(i().policy?.targets).join(", ")||"Not configured"),e.insert(J,()=>a(i().policy?.operations).join(", ")||"Not configured"),e.insert(K,()=>a(i().policy?.previewProviders).join(", ")||"Not configured"),e.insert(W,()=>w(i().policySource,"Unknown")),e.insert(ge,()=>w(i().policyHash,"Unavailable")),l})(),(()=>{var l=Xr();return l.firstChild,e.insert(l,e.createComponent(r.Show,{get when(){return a(i().policy?.requiredChecks).length},get fallback(){return oi()},get children(){var m=lt();return e.insert(m,e.createComponent(r.For,{get each(){return a(i().policy?.requiredChecks)},children:g=>(()=>{var o=Ct(),u=o.firstChild;return e.insert(u,g),o})()})),m}}),null),l})(),(()=>{var l=ei();return l.firstChild,e.insert(l,e.createComponent(r.Show,{get when(){return a(i().verificationCommands).length},get fallback(){return li()},get children(){var m=lt();return e.insert(m,e.createComponent(r.For,{get each(){return a(i().verificationCommands)},children:g=>(()=>{var o=Ct(),u=o.firstChild;return e.insert(u,g),o})()})),m}}),null),l})(),(()=>{var l=ri();return l.firstChild,e.insert(l,e.createComponent(r.Show,{get when(){return e.memo(()=>!!i().branches?.main)()&&i().branches?.dev},get fallback(){return si()},get children(){return[(()=>{var m=ti();return e.insert(m,(()=>{var g=e.memo(()=>i().branches?.main===i().branches?.dev);return()=>g()?`Trunk branch ${i().branches?.main}: direct push is blocked until an authenticated approval adapter exists.`:`Non-force direct pushes to ${i().branches?.dev} are permitted by the branch guard; direct pushes to ${i().branches?.main} and other targets are blocked.`})()),m})(),ni()]}}),null),l})(),(()=>{var l=ii();return l.firstChild,e.insert(l,e.createComponent(r.Show,{get when(){return i().preview},get fallback(){return di()},children:m=>[(()=>{var g=ci(),o=g.firstChild,u=o.nextSibling;return u.nextSibling,e.insert(g,()=>m().provider,u),e.insert(g,()=>w(m().branch,"Unknown"),null),g})(),(()=>{var g=ui();return g.firstChild,e.insert(g,()=>w(m().url,"Not configured"),null),g})(),(()=>{var g=pi(),o=g.firstChild,u=o.nextSibling;return u.nextSibling,e.insert(g,()=>m().sources.join(", ")||"None",u),g})(),(()=>{var g=lt();return e.insert(g,e.createComponent(r.For,{get each(){return m().guidance},children:o=>(()=>{var u=gi();return e.insert(u,o),u})()})),g})()]}),null),l})(),ai()]})}})}function _i(t){const[n,a]=r.createSignal(null),[i,l]=r.createSignal(""),[m,g]=r.createSignal(!1),[o,u]=r.createSignal(""),[b,d]=r.createSignal(""),p=()=>!!n()&&JSON.stringify({...n().settings,verificationCommands:b().split(`
`).map($=>$.trim()).filter(Boolean)})!==i();r.createEffect(()=>t.onDirty(p())),r.onCleanup(()=>t.onDirty(!1));async function v(){if(!(p()&&!window.confirm("Discard unsaved project settings and reload?"))){g(!0),u("");try{const $=await t.editor.load(),h=$.settings??{branches:{main:t.data.branches?.main??"",dev:t.data.branches?.dev??""},verificationCommands:H(t.data.verificationCommands),preview:{provider:t.data.preview?.provider==="vercel"||t.data.preview?.provider==="other"?t.data.preview.provider:"none",url:t.data.preview?.url??"",branch:t.data.preview?.branch??""},memory:{enabled:!0}};a({...$,settings:h}),d(h.verificationCommands.join(`
`)),l(JSON.stringify(h))}catch($){u($ instanceof Error?$.message:String($))}finally{g(!1)}}}function y($){a(h=>h&&h.settings?{...h,settings:{...h.settings,...$}}:h),u("")}async function s(){const $=n();if(!$?.settings||m())return;const h={...$.settings,verificationCommands:b().split(`
`).map(x=>x.trim()).filter(Boolean)};if(!h.branches.main.trim()||!h.branches.dev.trim()){u("Enter both branch names.");return}g(!0),u("");try{const x=await t.editor.save({...$,settings:h});a(x),l(JSON.stringify(x.settings)),d(x.settings?.verificationCommands.join(`
`)??""),u("Saved. Settings apply to new runs.")}catch(x){u(`Save failed: ${x instanceof Error?x.message:String(x)}. Your draft was retained.`)}finally{g(!1)}}return(()=>{var $=fi(),h=$.firstChild,x=h.nextSibling,E=x.nextSibling;return E.$$click=()=>{v()},e.insert($,e.createComponent(r.Show,{get when(){return n()?.settings},children:N=>[(()=>{var C=bi(),I=C.firstChild,M=I.nextSibling;return M.nextSibling,e.insert(C,()=>n()?.target,M),e.insert(C,()=>n()?.revision,null),C})(),e.createComponent(r.For,{get each(){return n()?.warnings??[]},children:C=>(()=>{var I=qt();return e.insert(I,C),I})()}),(()=>{var C=vi(),I=C.firstChild,M=I.firstChild,O=M.firstChild,te=O.nextSibling,J=M.nextSibling,B=J.firstChild,q=B.nextSibling,K=J.nextSibling,se=K.firstChild,X=se.nextSibling,W=K.nextSibling,ae=W.firstChild,pe=ae.nextSibling,ge=W.nextSibling,me=ge.firstChild,_e=me.nextSibling,he=ge.nextSibling,be=he.firstChild,G=be.nextSibling,c=he.nextSibling,S=c.firstChild,k=S.nextSibling;return te.$$input=P=>y({branches:{...N().branches,main:P.currentTarget.value}}),q.$$input=P=>y({branches:{...N().branches,dev:P.currentTarget.value}}),X.$$input=P=>d(P.currentTarget.value),pe.addEventListener("change",P=>y({preview:{...N().preview,provider:P.currentTarget.value}})),_e.$$input=P=>y({preview:{...N().preview,url:P.currentTarget.value}}),G.$$input=P=>y({preview:{...N().preview,branch:P.currentTarget.value}}),k.addEventListener("change",P=>y({memory:{enabled:P.currentTarget.value==="enabled"}})),e.effect(()=>C.disabled=m()),e.effect(()=>te.value=N().branches.main),e.effect(()=>q.value=N().branches.dev),e.effect(()=>X.value=b()),e.effect(()=>pe.value=N().preview.provider),e.effect(()=>_e.value=N().preview.url),e.effect(()=>G.value=N().preview.branch),e.effect(()=>k.value=N().memory.enabled?"enabled":"disabled"),C})(),$i(),(()=>{var C=wi();return C.$$click=()=>{s()},e.insert(C,()=>m()?"Saving…":"Save settings"),e.effect(()=>C.disabled=m()||!p()),C})()]}),null),e.insert($,e.createComponent(r.Show,{get when(){return e.memo(()=>!!m())()&&!n()},get children(){return mi()}}),null),e.insert($,e.createComponent(r.Show,{get when(){return o()},get children(){var N=hi();return e.insert(N,o),N}}),null),e.effect(()=>E.disabled=m()),$})()}e.delegateEvents(["click","input"]);var yi=e.template('<div class="cdt-row cdt-wrap cdt-meta"><span></span><span class="cdt-mono cdt-muted">'),Si=e.template("<button class=cdt-back type=button>"),Ci=e.template("<div class=cdt-error role=alert><div class=cdt-error-detail>"),ki=e.template("<ol class=cdt-inspector-list>"),Ai=e.template("<details class=cdt-inspector-disclosure><summary>Recent plan history (<!>)"),Mi=e.template("<div class=cdt-root><header class=cdt-header><div class=cdt-title></div><div class=cdt-subtitle>"),Ni=e.template("<p class=cdt-muted>Legacy or unversioned plan. No revision history is available."),Ri=e.template("<li><span class=cdt-mono>v</span> <!> <time class=cdt-muted>"),kt=e.template("<div>");const It=["runs","dag","gates","refinements","memory","routing","agents","project"];function ji(t){return It.find(n=>n===t)??"runs"}const Pi=3e3;function Ei(t){const n=Se.usePlugin(),a=()=>n.client.rpc(Lt),[i,l]=r.createSignal([]),[m,g]=r.createSignal(null),[o,u]=r.createSignal(null),[b,d]=r.createSignal(null),[p,v]=r.createSignal(!0),[y,s]=r.createSignal(null),[$,h]=r.createSignal(!1),[x,E]=r.createSignal(null),[N,C]=r.createSignal(null),[I,M]=r.createSignal(null),[O,te]=r.createSignal(null),[J,B]=r.createSignal(null),[q,K]=r.createSignal(null),[se,X]=r.createSignal(null),[W,ae]=r.createSignal(null),[pe,ge]=r.createSignal(null),[me,_e]=r.createSignal(!0),[he,be]=r.createSignal(!1),[G,c]=r.createSignal(!0),[S,k]=r.createSignal(null),[P,Y]=r.createSignal([]),[f,R]=r.createSignal({}),[L,Q]=r.createSignal({}),[V,D]=r.createSignal({});function z(F,j){D(U=>U[F]===j?U:{...U,[F]:j})}const oe=F=>{Object.values(V()).some(Boolean)&&(F.preventDefault(),F.returnValue="")};window.addEventListener("beforeunload",oe),r.onCleanup(()=>window.removeEventListener("beforeunload",oe));const A=()=>ji(t.tab.id),re=r.createMemo(()=>i().find(F=>F.id===x())??N());let Z=0,ve=0,$e=!1,le=!1;r.onCleanup(()=>{$e=!0,Z++,ve++});async function ne(F){try{return Dt(await F())}catch(j){return{data:null,error:j instanceof Error?j.message:String(j)}}}r.createEffect(()=>{const F=t.session.directory;Y(j=>j.includes(F)?j:[...j,F]),Z++,ve++,le=!1,l([]),g(null),s(null),h(!1),E(null),C(null),u(null),d(null),v(!0),M(null),te(null),B(null),K(null),X(null),ae(null),ge(null),_e(!0),c(!0),k(null)}),r.createEffect(()=>{const F=t.session.directory,j=A(),U=x(),ie=Z;let _=!0,ee=!1;const ce=()=>_&&!$e&&ie===Z,fe={directory:F};let Me=0,Ne=[];k(null),["runs","memory","agents","project"].includes(j)||(M(null),te(null),B(null),K(null),ae(null),ge(null),be(!!U));async function we(){if(!(ee||!ce())){ee=!0;try{if(j==="runs"){const[de,ue,Re]=await Promise.all([ne(()=>a().runs({limit:50},{location:fe})),ne(()=>a().workspace({},{location:fe})),ne(()=>a().runs({limit:200,states:Ht},{location:fe}))]);if(!ce())return;_e(!1),de.data&&(l(Be=>et(H(de.data?.runs),et(H(Re.data?.runs),Be))),le||(s(de.data.nextCursor),le=!0)),ue.data&&g(ue.data),k(de.error??ue.error??Re.error)}else if(j==="agents"){const de=await ne(()=>a().configuration({},{location:fe}));if(!ce())return;v(!1),de.data&&(u(de.data),R(ue=>({...ue,[F]:de.data}))),k(de.error)}else if(j==="project"){const de=await ne(()=>a().project({},{location:fe}));if(!ce())return;v(!1),de.data&&(d(de.data),Q(ue=>({...ue,[F]:de.data}))),k(de.error)}else if(j==="memory"){const de=await ne(()=>a().memory({limit:50},{location:fe}));if(!ce())return;c(!1),X(de.data),k(de.error)}else if(U){const de=j==="dag"?[ne(()=>a().run({runId:U},{location:fe})),ne(()=>a().dag({runId:U},{location:fe})),ne(()=>a().gates({runId:U},{location:fe})),ne(()=>a().routing({runId:U},{location:fe}))]:j==="gates"?[ne(()=>a().gates({runId:U},{location:fe}))]:j==="refinements"?[ne(()=>a().refinements({runId:U},{location:fe}))]:[ne(()=>a().routing({runId:U},{location:fe})),ne(()=>a().timeline({runId:U,afterSequence:Me,limit:200},{location:fe}))],ue=await Promise.all(de);if(!ce())return;if(be(!1),j==="dag")M(ue[0].data),te(ue[1].data),B(ue[2].data),ae(ue[3].data),ue[0].data?.summary&&C(ue[0].data.summary);else if(j==="gates")B(ue[0].data);else if(j==="refinements")K(ue[0].data);else{ae(ue[0].data);const Re=ue[1].data;Re&&(Ne=[...Ne,...H(Re.events)],Me=Re.lastSequence,ge({...Re,events:Ne}))}k(ue.find(Re=>Re.error)?.error??null)}}finally{ee=!1}}}we();const Fe=setInterval(()=>{we()},Pi);r.onCleanup(()=>{_=!1,clearInterval(Fe)})});async function Ie(){const F=y();if(!F||$())return;const j=Z,U=++ve,ie={directory:t.session.directory};h(!0);const _=await ne(()=>a().runs({limit:50,cursor:F},{location:ie}));$e||j!==Z||U!==ve||(h(!1),_.data&&(l(ee=>et(ee,H(_.data?.runs))),s(_.data.nextCursor)),k(_.error))}async function Oe(F,j){if(!F)return null;const U=Z,ie={directory:t.session.directory},_=await ne(()=>a().memoryBlock({label:F,version:j},{location:ie}));return $e||U!==Z?null:_.error?(k(_.error),null):je(_.data)&&je(_.data.block)?_.data.block:_.data}async function Te(F,j,U,ie){if($e||ie!==Z||U!==t.session.directory)throw new Error("Project changed. Reload the target before saving.");const _=await ne(()=>a()[F](j,{location:{directory:U}}));if($e||ie!==Z||U!==t.session.directory)throw new Error("Project changed. Reload the target before saving.");if(_.error||!_.data)throw new Error(_.error??"No document returned.");return _.data}const Ze={async load(F,j){const U=t.session.directory,ie=Z,_=await Te("agentDocument",{agentId:F,scope:j},U,ie);if(!_.writable)throw new Error((_.warnings||[]).join(" ")||"Target is not writable.");const[ee,ce=""]=(_.fields.model||"").split("#");return{revision:_.revision,target:_.target,warnings:_.warnings,original:_.fields,values:{model:ee,variant:ce,steps:_.fields.steps==null?"":String(_.fields.steps),system:_.fields.system,permissions:JSON.stringify(_.fields.permissions,null,2)},directory:U,generation:ie}},async save(F,j,U){const ie=U,_=U.values,ee=ie.original,ce=_.variant?`${_.model}#${_.variant}`:_.model,fe=JSON.parse(_.permissions),Me={};ce!==ee.model&&(Me.model=ce);const Ne=_.steps?Number(_.steps):null;if(Ne!==ee.steps&&(Me.steps=Ne),_.system!==ee.system&&(Me.system=_.system),JSON.stringify(fe)!==JSON.stringify(ee.permissions)&&(Me.permissions=fe),ie.directory!==t.session.directory)throw new Error("Project changed. Return to the original project to save.");const we=await Te("saveAgentConfiguration",{agentId:F,scope:j,expectedRevision:U.revision,fields:Me},ie.directory,Z),[Fe,de=""]=(we.fields.model||"").split("#");return{...ie,original:we.fields,warnings:we.warnings,revision:we.revision,target:we.target,values:{model:Fe,variant:de,steps:we.fields.steps==null?"":String(we.fields.steps),system:we.fields.system,permissions:JSON.stringify(we.fields.permissions,null,2)}}}},Ve={async load(){const F=t.session.directory,j=Z;return{...await Te("projectSettings",{},F,j),directory:F,generation:j}},async save(F){const j=F;return{...await Te("saveProjectSettings",{expectedRevision:j.revision,settings:j.settings},j.directory,j.directory===t.session.directory?Z:j.generation),directory:j.directory,generation:j.generation}}};function Xe(F){C(i().find(j=>j.id===F)??null),E(F),n.layout.open(`${n.id}:dag`,t.session)}return(()=>{var F=Mi(),j=F.firstChild,U=j.firstChild,ie=U.nextSibling;return e.insert(U,()=>(m()?.projectRoot??t.session.directory).split("/").filter(Boolean).pop()??n.t("panel.title")),e.insert(ie,(()=>{var _=e.memo(()=>!!["runs","memory","agents","project"].includes(A()));return()=>_()?m()?.projectRoot??t.session.directory:re()?.objective??n.t("panel.noRun")})()),e.insert(j,e.createComponent(r.Show,{get when(){return e.memo(()=>!!re())()&&!["runs","memory","agents","project"].includes(A())},get children(){var _=yi(),ee=_.firstChild,ce=ee.nextSibling;return e.insert(_,e.createComponent(ye,{get tone(){return Pe(re()?.state)},get label(){return re()?.state??n.t("common.unknown")}}),ee),e.insert(ee,()=>n.t("runs.progress",{completed:Pt(re()?.counts??{},re()?.taskCount??0).completed,total:re()?.taskCount??0})),e.insert(ce,x),_}}),null),e.insert(F,e.createComponent(r.Show,{get when(){return!["runs","memory","agents","project"].includes(A())},get children(){var _=Si();return _.$$click=()=>n.layout.open(`${n.id}:runs`,t.session),e.insert(_,()=>n.t("navigation.backRuns")),_}}),null),e.insert(F,e.createComponent(r.Show,{get when(){return S()},get children(){var _=Ci(),ee=_.firstChild;return e.insert(_,()=>n.t("common.error",{message:S()??""}),ee),e.insert(ee,()=>n.t("common.retryHint")),_}}),null),e.insert(F,e.createComponent(r.Show,{get when(){return e.memo(()=>A()==="dag")()&&I()},get children(){var _=Ai(),ee=_.firstChild,ce=ee.firstChild,fe=ce.nextSibling;return fe.nextSibling,e.insert(ee,()=>I()?.planRevisions?.length??0,fe),e.insert(_,e.createComponent(r.Show,{get when(){return I()?.planRevisions?.length},get fallback(){return Ni()},get children(){var Me=ki();return e.insert(Me,e.createComponent(r.For,{get each(){return I()?.planRevisions??[]},children:Ne=>(()=>{var we=Ri(),Fe=we.firstChild;Fe.firstChild;var de=Fe.nextSibling,ue=de.nextSibling,Re=ue.nextSibling,Be=Re.nextSibling;return e.insert(Fe,()=>Ne.revision,null),e.insert(we,()=>Ne.reason,ue),e.insert(Be,()=>Ye(Ne.createdAt)),e.effect(()=>e.setAttribute(Be,"datetime",Ne.createdAt)),we})()})),Me}}),null),_}}),null),e.insert(F,e.createComponent(r.Switch,{get children(){return[e.createComponent(r.Match,{get when(){return A()==="runs"},get children(){return e.createComponent(jr,{get runs(){return i()},get selectedId(){return x()},get loading(){return me()},get workspace(){return m()},get nextCursor(){return y()},get loadingMore(){return $()},onMore:Ie,onSelect:Xe})}}),e.createComponent(r.Match,{get when(){return A()==="dag"},get children(){return e.createComponent(jn,e.mergeProps({get data(){return O()},get loading(){return he()},get hasRun(){return!!x()}},()=>({detail:I(),gates:J(),routing:W()})))}}),e.createComponent(r.Match,{get when(){return A()==="gates"},get children(){return e.createComponent(Jn,{get data(){return J()},get loading(){return he()},get hasRun(){return!!x()}})}}),e.createComponent(r.Match,{get when(){return A()==="refinements"},get children(){return e.createComponent(ur,{get data(){return q()},get loading(){return he()},get hasRun(){return!!x()}})}}),e.createComponent(r.Match,{get when(){return A()==="memory"},get children(){return e.createComponent(ar,{get data(){return se()},get loading(){return G()},loadBlock:Oe,get scopeKey(){return t.session.directory}})}}),e.createComponent(r.Match,{get when(){return A()==="routing"},get children(){return e.createComponent(Sr,{get data(){return W()},get timeline(){return pe()},get loading(){return he()},get hasRun(){return!!x()}})}})]}}),null),e.insert(F,e.createComponent(r.For,{get each(){return P()},children:_=>[(()=>{var ee=kt();return e.insert(ee,e.createComponent(Qr,{get data(){return f()[_]??null},get loading(){return p()},editor:Ze,onDirty:ce=>z(`${_}:agent`,ce)})),e.effect(()=>ee.hidden=A()!=="agents"||_!==t.session.directory),ee})(),(()=>{var ee=kt();return e.insert(ee,e.createComponent(xi,{get data(){return L()[_]??null},get loading(){return p()},editor:Ve,onDirty:ce=>z(`${_}:project`,ce)})),e.effect(()=>ee.hidden=A()!=="project"||_!==t.session.directory),ee})()]}),null),e.effect(()=>e.setAttribute(F,"data-color-mode",n.appearance?.mode?.())),F})()}e.delegateEvents(["click"]);const qi=`
.cdt-root {
  --cdt-canvas-bg: var(--background-base, #f7f8fa);
  --cdt-node-bg: var(--background-raised-base, #ffffff);
  --cdt-border: color-mix(in oklab, currentColor 14%, transparent);
  --cdt-border-strong: color-mix(in oklab, currentColor 26%, transparent);
  --cdt-muted: color-mix(in oklab, currentColor 58%, transparent);
  --cdt-surface: color-mix(in oklab, currentColor 4%, transparent);
  --cdt-surface-strong: color-mix(in oklab, currentColor 8%, transparent);
  --cdt-focus: #3b82f6;
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  min-height: 0;
  padding: 12px;
  box-sizing: border-box;
  overflow: auto;
  font: inherit;
  font-size: 12px;
  line-height: 1.45;
  color: inherit;
}
.cdt-root[data-color-mode="dark"] { --cdt-canvas-bg: var(--background-base, #191c22); --cdt-node-bg: var(--background-raised-base, #252a32); }
.cdt-root *,
.cdt-root *::before,
.cdt-root *::after {
  box-sizing: border-box;
}
.cdt-root button {
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.cdt-root :is(button, [tabindex]):focus-visible {
  outline: 2px solid var(--cdt-focus);
  outline-offset: 2px;
  border-radius: 4px;
}

.cdt-header {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--cdt-border);
}
.cdt-title {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.01em;
}
.cdt-subtitle {
  color: var(--cdt-muted);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cdt-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.cdt-section + .cdt-section {
  margin-top: 4px;
}
.cdt-heading {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--cdt-muted);
}
.cdt-subheading {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
}
.cdt-label {
  display: block;
  margin-top: 2px;
  color: var(--cdt-muted);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.cdt-muted {
  color: var(--cdt-muted);
}
.cdt-strong {
  font-weight: 600;
}
.cdt-mono {
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 0.95em;
}
.cdt-meta {
  font-size: 11px;
}
.cdt-truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cdt-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.cdt-between {
  justify-content: space-between;
}
.cdt-wrap {
  flex-wrap: wrap;
}
.cdt-grow {
  flex: 1 1 auto;
  min-width: 0;
}

.cdt-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.cdt-card {
  padding: 8px 10px;
  border: 1px solid var(--cdt-border);
  border-radius: 8px;
  background: var(--cdt-surface);
}
.cdt-card-tight {
  padding: 6px 8px;
}
.cdt-card + .cdt-card {
  margin-top: 6px;
}

.cdt-badge {
  --cdt-tone: currentColor;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  max-width: 100%;
  padding: 0 6px;
  border: 1px solid color-mix(in oklab, var(--cdt-tone) 38%, transparent);
  border-radius: 999px;
  background: color-mix(in oklab, var(--cdt-tone) 10%, transparent);
  color: color-mix(in oklab, var(--cdt-tone) 55%, currentColor);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.03em;
  line-height: 16px;
  text-transform: uppercase;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cdt-badge[data-tone="pending"] { --cdt-tone: #9ca3af; }
.cdt-badge[data-tone="ready"] { --cdt-tone: #3b82f6; }
.cdt-badge[data-tone="running"] { --cdt-tone: #f59e0b; }
.cdt-badge[data-tone="completed"] { --cdt-tone: #10b981; }
.cdt-badge[data-tone="failed"] { --cdt-tone: #ef4444; }
.cdt-badge[data-tone="blocked"] { --cdt-tone: #8b5cf6; }
.cdt-badge[data-tone="unknown"] { --cdt-tone: #9ca3af; }

.cdt-dot {
  --cdt-tone: currentColor;
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--cdt-tone);
}
.cdt-dot[data-tone="pending"] { --cdt-tone: #9ca3af; }
.cdt-dot[data-tone="ready"] { --cdt-tone: #3b82f6; }
.cdt-dot[data-tone="running"] { --cdt-tone: #f59e0b; }
.cdt-dot[data-tone="completed"] { --cdt-tone: #10b981; }
.cdt-dot[data-tone="failed"] { --cdt-tone: #ef4444; }
.cdt-dot[data-tone="blocked"] { --cdt-tone: #8b5cf6; }
.cdt-dot[data-tone="unknown"] { --cdt-tone: #9ca3af; }

.cdt-empty {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 18px 12px;
  border: 1px dashed var(--cdt-border);
  border-radius: 8px;
  text-align: center;
}
.cdt-empty-title {
  font-weight: 600;
}
.cdt-empty-body {
  color: var(--cdt-muted);
  font-size: 11px;
}

.cdt-error {
  padding: 6px 8px;
  border: 1px solid color-mix(in oklab, #ef4444 40%, transparent);
  border-radius: 6px;
  background: color-mix(in oklab, #ef4444 9%, transparent);
  color: color-mix(in oklab, #ef4444 45%, currentColor);
  font-size: 11px;
}
.cdt-error-detail {
  color: var(--cdt-muted);
}

.cdt-run {
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--cdt-border);
  border-radius: 8px;
  background: var(--cdt-surface);
  transition: border-color 120ms ease, background-color 120ms ease;
}
.cdt-run:hover {
  border-color: var(--cdt-border-strong);
  background: var(--cdt-surface-strong);
}
.cdt-run[aria-pressed="true"] {
  border-color: color-mix(in oklab, currentColor 42%, transparent);
  background: var(--cdt-surface-strong);
}
.cdt-run-objective {
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  font-weight: 600;
  line-height: 1.35;
}

.cdt-progress {
  display: block;
  width: 100%;
  height: 3px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in oklab, currentColor 12%, transparent);
}
.cdt-progress > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: color-mix(in oklab, currentColor 55%, transparent);
}

.cdt-dag-canvas {
  overflow: auto;
  max-height: 46vh;
  border: 1px solid var(--cdt-border);
  border-radius: 8px;
  background:
    radial-gradient(circle at 1px 1px, color-mix(in oklab, currentColor 10%, transparent) 1px, transparent 0)
    0 0 / 14px 14px;
}
.cdt-dag-inner {
  position: relative;
  min-width: 100%;
}
.cdt-dag-edges {
  position: absolute;
  inset: 0;
  overflow: visible;
  pointer-events: none;
}
.cdt-dag-edge {
  fill: none;
  stroke: color-mix(in oklab, currentColor 28%, transparent);
  stroke-width: 1.5;
}
.cdt-dag-edge[data-resolved="false"] {
  stroke-dasharray: 4 4;
}
.cdt-dag-node {
  --cdt-tone: #9ca3af;
  position: absolute;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 1px;
  padding: 4px 7px 4px 9px;
  overflow: hidden;
  border: 1px solid var(--cdt-border);
  border-left: 3px solid var(--cdt-tone);
  border-radius: 6px;
  background: color-mix(in oklab, currentColor 4%, transparent);
  transition: background-color 120ms ease, border-color 120ms ease;
}
.cdt-dag-node:hover {
  background: var(--cdt-surface-strong);
}
.cdt-dag-node[aria-pressed="true"] {
  border-color: color-mix(in oklab, var(--cdt-tone) 60%, var(--cdt-border));
  background: var(--cdt-surface-strong);
}
.cdt-dag-node[data-ghost="true"] {
  border-style: dashed;
  border-left-style: solid;
  opacity: 0.72;
}
.cdt-dag-node[data-tone="pending"] { --cdt-tone: #9ca3af; }
.cdt-dag-node[data-tone="ready"] { --cdt-tone: #3b82f6; }
.cdt-dag-node[data-tone="running"] { --cdt-tone: #f59e0b; }
.cdt-dag-node[data-tone="completed"] { --cdt-tone: #10b981; }
.cdt-dag-node[data-tone="failed"] { --cdt-tone: #ef4444; }
.cdt-dag-node[data-tone="blocked"] { --cdt-tone: #8b5cf6; }
.cdt-dag-node[data-tone="unknown"] { --cdt-tone: #9ca3af; }
.cdt-dag-title {
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.25;
}
.cdt-dag-meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--cdt-muted);
  font-size: 10px;
}

.cdt-kv {
  display: grid;
  grid-template-columns: minmax(76px, auto) minmax(0, 1fr);
  gap: 2px 10px;
  margin: 6px 0 0;
}
.cdt-kv > dt {
  color: var(--cdt-muted);
  font-size: 11px;
}
.cdt-kv > dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 11px;
}

.cdt-chip {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  padding: 0 5px;
  border: 1px solid var(--cdt-border);
  border-radius: 4px;
  background: var(--cdt-surface);
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 10px;
  line-height: 16px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cdt-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.cdt-verify {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 5px 0;
  border-top: 1px solid var(--cdt-border);
}
.cdt-verify:first-child {
  border-top: 0;
  padding-top: 0;
}
.cdt-command {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11px;
}
.cdt-finding {
  padding: 6px 8px;
  border: 1px solid var(--cdt-border);
  border-radius: 6px;
  background: color-mix(in oklab, currentColor 2%, transparent);
}
.cdt-finding[data-blocking="true"] {
  border-color: color-mix(in oklab, #ef4444 45%, transparent);
}
.cdt-finding + .cdt-finding {
  margin-top: 4px;
}
.cdt-evidence,
.cdt-required {
  margin: 3px 0 0;
  font-size: 11px;
  overflow-wrap: anywhere;
}
.cdt-required {
  color: color-mix(in oklab, #f59e0b 45%, currentColor);
}

.cdt-pre {
  max-height: 280px;
  margin: 0;
  padding: 8px;
  overflow: auto;
  border: 1px solid var(--cdt-border);
  border-radius: 6px;
  background: var(--cdt-surface);
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.cdt-qa {
  padding: 6px 8px;
  border-left: 2px solid var(--cdt-border-strong);
}
.cdt-qa-question {
  font-weight: 600;
  font-size: 11px;
}
.cdt-qa-answer {
  margin: 2px 0 0;
  color: var(--cdt-muted);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.cdt-memory {
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 100%;
  padding: 7px 9px;
  border: 1px solid var(--cdt-border);
  border-radius: 8px;
  background: var(--cdt-surface);
  transition: background-color 120ms ease, border-color 120ms ease;
}
.cdt-memory:hover {
  background: var(--cdt-surface-strong);
  border-color: var(--cdt-border-strong);
}
.cdt-memory[aria-expanded="true"] {
  border-color: color-mix(in oklab, currentColor 38%, transparent);
}
.cdt-memory-preview {
  color: var(--cdt-muted);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cdt-memory-content {
  margin-top: 6px;
}

.cdt-event {
  display: flex;
  gap: 8px;
  padding: 5px 0;
  border-top: 1px solid var(--cdt-border);
}
.cdt-event:first-child {
  border-top: 0;
}
.cdt-event-seq {
  flex: 0 0 auto;
  min-width: 26px;
  color: var(--cdt-muted);
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 10px;
  text-align: right;
}
.cdt-event-body {
  min-width: 0;
  flex: 1 1 auto;
}
.cdt-event-summary {
  margin: 1px 0 0;
  color: var(--cdt-muted);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.cdt-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (prefers-reduced-motion: reduce) {
  .cdt-root * {
    transition: none !important;
  }
}
`,Ii=`
.cdt-root { container-type: inline-size; }
.cdt-run-counts { display:flex; flex-wrap:wrap; gap:8px 20px; padding:8px 0; border-bottom:1px solid var(--cdt-border); }
.cdt-run-counts strong { font-size:16px; margin-right:3px; }
.cdt-run-toolbar { display:flex; flex-wrap:wrap; align-items:end; gap:8px 12px; }
.cdt-run-toolbar label { display:flex; flex-direction:column; gap:3px; color:var(--cdt-muted); }
.cdt-run-toolbar input,.cdt-run-toolbar select { color:inherit; font:inherit; background:var(--cdt-surface); border:1px solid var(--cdt-border-strong); border-radius:4px; padding:5px 7px; max-width:100%; }
.cdt-root :is(input,select):focus-visible { outline:2px solid var(--cdt-focus); outline-offset:2px; }
.cdt-run-switch { display:flex; gap:2px; border-bottom:1px solid var(--cdt-border); }
.cdt-root .cdt-run-switch button { padding:6px 9px; border-bottom:2px solid transparent; }
.cdt-root .cdt-run-switch button[aria-pressed=true] { border-color:currentColor; font-weight:600; }
.cdt-table-scroll { max-width:100%; overflow-x:auto; }
.cdt-run-table { width:100%; min-width:764px; border-collapse:collapse; table-layout:fixed; text-align:left; }
.cdt-run-table th,.cdt-run-table td { padding:8px; border-bottom:1px solid var(--cdt-border); vertical-align:top; }
.cdt-run-table th { color:var(--cdt-muted); font-weight:600; }
.cdt-run-table th:nth-child(1),.cdt-run-table td:nth-child(1) { width:270px; }
.cdt-run-table th:nth-child(2),.cdt-run-table td:nth-child(2) { width:155px; }
.cdt-run-table th:nth-child(3),.cdt-run-table td:nth-child(3) { width:72px; }
.cdt-run-table th:nth-child(4),.cdt-run-table td:nth-child(4) { width:175px; }
.cdt-run-table th:nth-child(5),.cdt-run-table td:nth-child(5) { width:92px; white-space:nowrap; }
.cdt-run-table td:nth-child(4) { overflow-wrap:anywhere; }
.cdt-run-table td:first-child { overflow-wrap:anywhere; }
.cdt-root .cdt-run-link { font-weight:600; text-decoration:underline; text-underline-offset:3px; }
.cdt-root .cdt-more,.cdt-root .cdt-back { padding:6px 9px; border:1px solid var(--cdt-border-strong); border-radius:4px; align-self:start; }
.cdt-root .cdt-more:disabled { opacity:.6; cursor:default; }
.cdt-root p { margin:0; }
@container (max-width: 420px) { .cdt-run-toolbar label { flex:1 1 130px; } }
`,Ti=`
.cdt-inspector-layout { display:flex; gap:12px; flex-wrap:wrap; min-width:0; }
.cdt-inspector-nav { display:flex; flex-direction:column; flex:1 1 130px; min-width:110px; max-width:210px; max-height:320px; overflow:auto; border:1px solid var(--cdt-border); border-radius:5px; }
.cdt-root .cdt-inspector-nav button { padding:6px 8px; overflow-wrap:anywhere; border-left:2px solid transparent; }
.cdt-root .cdt-inspector-nav button:hover { background:var(--cdt-surface-strong); }
.cdt-root .cdt-inspector-nav button[aria-pressed="true"] { border-left-color:currentColor; background:var(--cdt-surface-strong); font-weight:600; }
.cdt-inspector-detail { display:flex; flex-direction:column; gap:8px; flex:3 1 300px; min-width:0; }
.cdt-inspector-scroll { max-width:100%; overflow-x:auto; }
.cdt-inspector-table { width:100%; min-width:320px; border-collapse:collapse; text-align:left; }
.cdt-inspector-table :is(th,td) { border-bottom:1px solid var(--cdt-border); padding:6px 8px; vertical-align:top; overflow-wrap:anywhere; }
.cdt-inspector-table th { color:var(--cdt-muted); font-weight:600; }
.cdt-inspector-table th[scope=row] { min-width:105px; }
.cdt-inspector-note { margin:0; padding:8px; border-left:2px solid var(--cdt-border-strong); background:var(--cdt-surface); overflow-wrap:anywhere; }
.cdt-inspector-note p { margin:4px 0 0; }
.cdt-inspector-note ul { margin:4px 0 0; padding-left:20px; }
.cdt-inspector-disclosure { border-top:1px solid var(--cdt-border); padding:8px 0; min-width:0; }
.cdt-inspector-disclosure summary { cursor:pointer; font-weight:600; }
.cdt-inspector-disclosure summary:focus-visible { outline:2px solid var(--cdt-focus); outline-offset:2px; }
.cdt-inspector-disclosure .cdt-pre { margin:8px 0; }
.cdt-inspector-list,.cdt-inspector-sequence { margin:0; padding-left:20px; overflow-wrap:anywhere; }
.cdt-inspector-list li,.cdt-inspector-sequence li { padding:2px 0; }
.cdt-inspector-review { margin:6px 0; padding:6px 8px; border-left:2px solid var(--cdt-border-strong); overflow-wrap:anywhere; }
.cdt-inspector-review p { margin:3px 0; }
.cdt-skill-rule { display:flex; flex-wrap:wrap; gap:8px; align-items:end; margin:8px 0; min-width:0; }
.cdt-skill-rule label { display:flex; flex:1 1 130px; flex-direction:column; min-width:0; gap:4px; font-weight:600; }
.cdt-skill-rule :is(input,select) { width:100%; min-width:0; padding:6px 8px; color:inherit; font:inherit; background:var(--cdt-surface); border:1px solid var(--cdt-border-strong); border-radius:4px; }
.cdt-skill-rule :is(input,select):focus-visible { outline:2px solid var(--cdt-focus); outline-offset:2px; }
.cdt-editor-fieldset { border:0; margin:0; padding:0; min-width:0; }
.cdt-agent-draft > p { margin:8px 0; }
.cdt-agent-draft > .cdt-row select { color:inherit; font:inherit; background:var(--cdt-surface); border:1px solid var(--cdt-border-strong); border-radius:4px; padding:5px 8px; }
.cdt-agent-draft > .cdt-row select:focus-visible { outline:2px solid var(--cdt-focus); outline-offset:2px; }
.cdt-draft-fields { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr)); gap:10px; margin:10px 0; min-width:0; }
.cdt-draft-fields label { display:flex; flex-direction:column; gap:4px; min-width:0; font-weight:600; }
.cdt-draft-fields :is(input,select,textarea) { width:100%; min-width:0; padding:6px 8px; color:inherit; font:inherit; font-weight:400; background:var(--cdt-surface); border:1px solid var(--cdt-border-strong); border-radius:4px; }
.cdt-draft-fields textarea { resize:vertical; }
.cdt-draft-fields select:disabled { opacity:.65; }
.cdt-draft-fields :is(input,select,textarea):focus-visible { outline:2px solid var(--cdt-focus); outline-offset:2px; }
.cdt-draft-fields label span { font-weight:400; }
`,Fi={runs:"tab.runs",dag:"tab.dag",gates:"tab.gates",refinements:"tab.refinements",memory:"tab.memory",routing:"tab.routing",agents:"tab.agents",project:"tab.project"},Oi=Se.Plugin.define({i18n:{en:{"panel.title":"Conductor","panel.noRun":"No run selected","command.open":"Open Conductor panel","command.description":"Inspect runs, the task graph, gates, refinements, memory and model routing.","tab.runs":"Runs","tab.dag":"DAG","tab.gates":"Gates","tab.refinements":"Refinements","tab.memory":"Memory","tab.routing":"Routing","tab.agents":"Agents","tab.project":"Project","navigation.backRuns":"Back to runs","common.loading":"Loading…","common.unknown":"unknown","common.error":"Could not load data: {{message}}","common.retryHint":"The panel retries every 3 seconds.","runs.title":"Runs","runs.summary.one":"{{count}} run","runs.summary.other":"{{count}} runs","runs.events.one":"{{count}} event","runs.events.other":"{{count}} events","runs.empty.title":"No runs yet","runs.empty.body":"A run appears here once the supervisor starts one in this project.","runs.select":"Select run","runs.risk":"Risk","runs.mode":"Mode","runs.receipt":"receipt","runs.progress":"{{completed}}/{{total}} tasks","runs.updated":"Updated {{when}}","runs.noSelection":"Select a run","runs.empty.noSelection":"Pick a run in the Runs tab to inspect this view.","dag.title":"Task graph","dag.empty.title":"No task graph","dag.empty.body":"This run has no plan or tasks yet.","dag.cycles":"Dependency cycle","dag.dangling":"Unknown dependencies","dag.ghost":"ghost","dag.role":"Role","dag.model":"Model","dag.attempts":"Attempts","dag.layer":"Layer","dag.dependencies":"Dependencies","dag.noDependencies":"No dependencies","dag.hint":"Select a task to see its role, model, attempts and dependencies.","gates.title":"Gates","gates.empty.title":"No gates","gates.empty.body":"This run has no approvals or verification evidence yet.","gates.approvals":"Approvals","gates.noApprovals":"No approvals recorded.","gates.actor":"Actor","gates.expires":"Expires {{when}}","gates.verification":"Verification","gates.noVerifications":"No verification commands recorded.","gates.attempt":"Attempt {{no}}","gates.passed":"passed","gates.failed":"failed","gates.notRun":"not run","gates.exit":"exit {{code}}","gates.findings":"Review findings","gates.noFindings":"No findings.","gates.blocking":"blocking","gates.open":"open","gates.requiredFix":"Required fix","gates.mergeReady":"Merge ready","gates.mergeBlocked":"Merge blocked","refinements.title":"Refinements","refinements.state":"State","refinements.outcome":"Outcome","refinements.source":"Source","refinements.uncertainties":"Uncertainties","refinements.noUncertainties":"No uncertainties recorded.","refinements.qa":"Questions and answers","refinements.noQa":"No questions recorded.","refinements.question":"Question","refinements.answer":"Answer","refinements.openQuestions":"Open questions","refinements.noOpenQuestions":"No open questions.","refinements.requirements":"Requirements","refinements.noRequirements":"No requirements contract.","memory.title":"Memory","memory.summary.one":"{{count}} block","memory.summary.other":"{{count}} blocks","memory.empty.title":"No memory blocks","memory.empty.body":"Project memory appears here once a run records it.","memory.version":"v{{version}}","memory.scope":"Scope","memory.confidence":"Confidence","memory.reviewAfter":"Review after {{when}}","memory.noReview":"No review date","memory.expand":"Show content","memory.collapse":"Hide content","memory.loading":"Loading block…","memory.contentUnavailable":"Content unavailable.","routing.title":"Routing & timeline","routing.empty.title":"No routing data","routing.empty.body":"Routing and events appear after a run starts.","routing.assignments":"Fleet assignments","routing.noAssignments":"No fleet assignments.","routing.source":"Source","routing.observed":"Observed routes","routing.noObserved":"No attempts recorded.","routing.attempts":"{{count}} attempts","routing.avgDuration":"avg {{duration}}","routing.costs":"Cost and usage","routing.totalTokens":"Total tokens","routing.totalCost":"Total cost","routing.coverage":"Usage coverage","routing.coverageValue":"{{withUsage}}/{{attempts}} attempts","routing.usageUnavailable":"usage unavailable","routing.timeline":"Event timeline","routing.truncated":"More events available. Loading the next page on refresh.","routing.noEvents":"No events recorded."}},setup(t){const n=It.map(a=>({id:a,group:"conductor",closable:"hover",fallback:a==="runs",get title(){return t.t(Fi[a])}}));t.add(Se.Panel,{id:"conductor",region:"side",wide:!0,mobile:{get title(){return t.t("panel.title")},order:40,kind:"menu",icon:"terminal"},list:()=>n,render:a=>e.createComponent(Ei,{get tab(){return a.tab},get session(){return a.session},get screen(){return a.screen}})}),t.add(Se.Command,()=>({id:"open",title:t.t("command.open"),description:t.t("command.description"),section:"session",run:()=>{const a=t.sessions.current();a&&t.layout.toggle(`${t.id}:runs`,a)}})),t.add(Se.MenuItem,()=>{const a=t.sessions.current();return{menu:"session.panel",id:"open",title:t.t("panel.title"),description:t.t("command.description"),icon:"terminal",order:35,keybind:`${t.id}.open`,opened:!!a&&t.layout.state(`${t.id}:runs`,a)!=="closed",run:()=>{a&&t.layout.open(`${t.id}:runs`,a)}}}),t.add(Se.Style,qi+Ii+Ti)}});exports.default=Oi;
