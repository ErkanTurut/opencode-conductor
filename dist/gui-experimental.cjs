"use strict";Object.defineProperties(exports,{__esModule:{value:!0},[Symbol.toStringTag]:{value:"Module"}});const e=require("solid-js/web"),pe=require("@opencode/plugin/gui"),r=require("solid-js"),Ct=require("@opencode/plugin/rpc"),Ue={type:"object",properties:{},additionalProperties:!1},be={type:"object",additionalProperties:!0};function ye(t,n=[]){return{type:"object",properties:t,...n.length>0?{required:[...n]}:{},additionalProperties:!1}}const Ce={type:"string"},je={type:"number"},St={type:"array",items:Ce},kt="conductor",At=Ct.Rpc.define({id:kt,methods:{workspace:{input:Ue,output:be},configuration:{input:Ue,output:be},project:{input:Ue,output:be},runs:{input:ye({limit:je,cursor:Ce,states:St},[]),output:be},run:{input:ye({runId:Ce},["runId"]),output:be},dag:{input:ye({runId:Ce},["runId"]),output:be},gates:{input:ye({runId:Ce},["runId"]),output:be},refinements:{input:ye({runId:Ce},["runId"]),output:be},memory:{input:ye({limit:je},[]),output:be},memoryBlock:{input:ye({label:Ce,version:je},["label"]),output:be},routing:{input:ye({runId:Ce},[]),output:be},timeline:{input:ye({runId:Ce,afterSequence:je,limit:je},["runId"]),output:be}},events:{}});function Se(t){return typeof t=="object"&&t!==null&&!Array.isArray(t)}function Mt(t){if(t==null)return{data:null,error:"empty response"};if(Se(t)){if(t.ok===!1){const n=Se(t.error)?t.error:null,i=n&&typeof n.message=="string"&&n.message?n.message:"request failed";return{data:null,error:`${n&&typeof n.code=="string"&&n.code?`${n.code}: `:""}${i}`}}if(t.ok===!0&&"data"in t)return{data:t.data,error:null}}return{data:t,error:null}}function L(t){return Array.isArray(t)?t:[]}function ht(t){return Se(t)?t:{}}function b(t,n="unknown"){return typeof t=="string"&&t.length>0?t:typeof t=="number"&&Number.isFinite(t)||typeof t=="boolean"?String(t):n}const Rt=["openQuestions","open_questions","questions","open"],Nt=["contract","refinement","requirements"];function Pt(t){if(typeof t=="string")return t;if(!Se(t))return"";const n=t;for(const i of["question","title","text","prompt"]){const o=n[i];if(typeof o=="string"&&o.length>0)return o}return""}function qt(t){if(!Se(t))return!1;const n=t.answer;return typeof n=="string"?n.trim().length>0:!1}function Je(t,n){const i=[];for(const o of L(t)){if(!n&&qt(o))continue;const d=Pt(o);d&&i.push(d)}return i}function ft(t){if(Array.isArray(t))return Je(t,!0);if(!Se(t))return[];for(const n of Rt){const i=t[n];if(!Array.isArray(i))continue;const o=Je(i,n==="openQuestions"||n==="open_questions");if(o.length>0)return o}for(const n of Nt){const i=t[n];if(!Se(i))continue;const o=ft(i);if(o.length>0)return o}return[]}const It=new Set(["completed","cancelled","blocked","timed_out","failed"]),jt=["created","intake","awaiting_refinement","discovered","planned","awaiting_plan_approval","executing","validating","reviewing","repairing","integrating","awaiting_merge_approval","paused"],bt=t=>!It.has(t.state);function Ge(t,n){const i=new Set;return[...t,...n].filter(o=>!i.has(o.id)&&!!i.add(o.id))}function Et(t,n,i,o){const d=i.trim().toLowerCase();return t.filter(m=>bt(m)===n&&(!d||`${m.objective} ${m.id} ${m.state}`.toLowerCase().includes(d))).sort((m,$)=>o==="oldest"?m.updatedAt.localeCompare($.updatedAt):o==="objective"?m.objective.localeCompare($.objective):$.updatedAt.localeCompare(m.updatedAt))}function Ft(t){const n=t.counts??{},i=["failed","blocked","running","ready"].flatMap(o=>{const d=n[o];return typeof d=="number"&&d>0?[`${d} ${o}`]:[]});return i.length?i.join(", "):t.state.startsWith("awaiting_")?"Waiting for user input":t.state==="paused"?"Paused":"No recorded task activity"}function Tt(t,n){return t.width===n.width&&t.height===n.height&&t.nodes.length===n.nodes.length&&t.nodes.every((i,o)=>{const d=n.nodes[o];return d!==void 0&&i.id===d.id&&i.x===d.x&&i.y===d.y&&i.width===d.width&&i.height===d.height})}const Te={nodeWidth:168,nodeHeight:46,columnGap:12,layerGap:36};function ze(t,n){return typeof t=="number"&&Number.isFinite(t)&&t>0?t:n}function P(t){return Math.round(t*10)/10}function zt(t,n=[],i={},o="top-bottom"){const d={nodeWidth:ze(i.nodeWidth,Te.nodeWidth),nodeHeight:ze(i.nodeHeight,Te.nodeHeight),columnGap:ze(i.columnGap,Te.columnGap),layerGap:ze(i.layerGap,Te.layerGap)},m=new Set,$=[];for(const s of Array.isArray(t)?t:[]){const S=[];for(const v of Array.isArray(s)?s:[])typeof v!="string"||v.length===0||m.has(v)||(m.add(v),S.push(v));S.length>0&&$.push(S)}const a=[];for(const s of n)typeof s!="string"||s.length===0||m.has(s)||(m.add(s),a.push(s));a.length>0&&$.push(a);const u=[],g=Object.create(null);let c=0;$.forEach((s,S)=>{const v=d.nodeWidth,w=s.length*v+Math.max(0,s.length-1)*d.columnGap;c=Math.max(c,w),s.forEach((N,j)=>{const A={id:N,layer:S,column:j,x:o==="top-bottom"?j*(d.nodeWidth+d.columnGap):S*(d.nodeWidth+d.layerGap),y:o==="top-bottom"?S*(d.nodeHeight+d.layerGap):j*(d.nodeHeight+d.columnGap),width:d.nodeWidth,height:d.nodeHeight};u.push(A),g[N]=A})});const f=$.length;let h=0;for(const s of $)h=Math.max(h,s.length);const _=o==="top-bottom"?f===0?0:f*d.nodeHeight+(f-1)*d.layerGap:h===0?0:h*d.nodeHeight+(h-1)*d.columnGap;return o==="left-right"&&(c=f===0?0:f*d.nodeWidth+(f-1)*d.layerGap),{nodes:u,byId:g,width:c,height:_,layerCount:f,unplaced:a}}function Lt(t,n,i="top-bottom",o=20){if(t.id===n.id){if(i==="left-right"){const f=t.y+t.height/2;return`M ${P(t.x)} ${P(f)} C ${P(t.x-o*2)} ${P(t.y-o)}, ${P(t.x-o*2)} ${P(t.y+t.height+o)}, ${P(t.x)} ${P(f)}`}const g=t.x+t.width/2,c=t.y;return`M ${P(g)} ${P(c)} C ${P(t.x+t.width+o)} ${P(t.y-o*2)}, ${P(t.x-o)} ${P(t.y-o*2)}, ${P(g)} ${P(c)}`}if(t.layer===n.layer){if(i==="left-right"){const h=Math.min(t.y,n.y),_=Math.max(t.y+t.height,n.y+n.height),s=Math.min(t.x,n.x)-o;return`M ${P(t.x)} ${P(t.y+t.height/2)} C ${P(s)} ${P(h-o)}, ${P(s)} ${P(_+o)}, ${P(n.x)} ${P(n.y+n.height/2)}`}const g=Math.min(t.x,n.x),c=Math.max(t.x+t.width,n.x+n.width),f=Math.min(t.y,n.y)-o;return`M ${P(t.x+t.width/2)} ${P(t.y)} C ${P(g-o)} ${P(f)}, ${P(c+o)} ${P(f)}, ${P(n.x+n.width/2)} ${P(n.y)}`}if(i==="left-right"){const g=n.x>=t.x,c=g?t.x+t.width:t.x,f=t.y+t.height/2,h=g?n.x:n.x+n.width,_=n.y+n.height/2,s=Math.max(16,Math.abs(h-c)/2);return[`M ${P(c)} ${P(f)}`,`C ${P(c+(g?s:-s))} ${P(f)},`,`${P(h-(g?s:-s))} ${P(_)},`,`${P(h)} ${P(_)}`].join(" ")}const d=t.x+t.width/2,m=t.y+t.height,$=n.x+n.width/2,a=n.y,u=Math.max(16,Math.abs(a-m)/2);return[`M ${P(d)} ${P(m)}`,`C ${P(d)} ${P(m+u)},`,`${P($)} ${P(a-u)},`,`${P($)} ${P(a)}`].join(" ")}function Ot(t,n="",i=[]){const o=n.trim().toLocaleLowerCase(),d=new Set(i),m=t.filter($=>(!o||`${$.id} ${$.title??""} ${$.state??""}`.toLocaleLowerCase().includes(o))&&(d.size===0||d.has($.state??"unknown")));return{visible:m,hiddenCount:t.length-m.length}}function $t(t){return{x:Number.isFinite(t.x)?t.x:0,y:Number.isFinite(t.y)?t.y:0,scale:Number.isFinite(t.scale)?Math.max(1e-5,Math.min(2.5,t.scale)):1}}function Dt(t,n,i,o=28){const d=Math.max(1,t.width-Math.min(o*2,t.width*.5)),m=Math.max(1,t.height-Math.min(o*2,t.height*.5)),$=Math.min(1,d/Math.max(1,n),m/Math.max(1,i));return $t({x:(t.width-n*$)/2,y:(t.height-i*$)/2,scale:$})}function Xe(t,n,i,o=100){const d=$t(n),m=-d.x/d.scale-o,$=-d.y/d.scale-o,a=m+i.width/d.scale+o*2,u=$+i.height/d.scale+o*2;return t.nodes.filter(g=>g.x+g.width>=m&&g.x<=a&&g.y+g.height>=$&&g.y<=u)}const Ut={pending:"pending",queued:"pending",planned:"pending",created:"pending",discovered:"pending",todo:"pending",intake:"ready",awaiting_refinement:"blocked",awaiting_plan_approval:"blocked",awaiting_merge_approval:"blocked",paused:"blocked",ready:"ready",running:"running",executing:"running",validating:"running",reviewing:"running",repairing:"running",integrating:"running",in_progress:"running",inprogress:"running",leased:"running",claimed:"running",dispatched:"running",completed:"completed",complete:"completed",succeeded:"completed",success:"completed",passed:"completed",done:"completed",approved:"completed",failed:"failed",failure:"failed",error:"failed",rejected:"failed",declined:"failed",cancelled:"failed",blocked:"blocked",waiting:"blocked",interrupted:"blocked",skipped:"unknown"};function Re(t){return typeof t!="string"||t.length===0?"unknown":Ut[t.toLowerCase()]??"unknown"}function Gt(t){if(typeof t!="string")return"unknown";const n=t.toLowerCase();return n==="approved"||n==="pass"||n==="passed"||n==="allow"?"completed":n==="rejected"||n==="denied"||n==="fail"||n==="failed"?"failed":n==="pending"||n==="requested"?"pending":Re(n)}function Fe(t,n){return typeof t!="string"||n<=0?"":t.length<=n?t:`${t.slice(0,Math.max(0,n-1)).trimEnd()}…`}const Ee=1e3,qe=60*Ee,Ie=60*qe,Ve=24*Ie;function Vt(t,n=Date.now()){if(typeof t!="string"||t.length===0)return"unknown";const i=Date.parse(t);if(Number.isNaN(i))return"unknown";const o=Math.max(0,n-i);return o<45*Ee?"just now":o<Ie?`${Math.floor(o/qe)}m ago`:o<Ve?`${Math.floor(o/Ie)}h ago`:o<7*Ve?`${Math.floor(o/Ve)}d ago`:t.slice(0,10)}function De(t){return typeof t!="string"||t.length===0||Number.isNaN(Date.parse(t))?"unknown":t.slice(0,16).replace("T"," ")}function Ht(t){return typeof t!="string"||t.length===0||Number.isNaN(Date.parse(t))?"unknown":t.slice(0,10)}function vt(t){if(typeof t!="number"||!Number.isFinite(t)||t<0)return"unknown";if(t<Ee)return`${Math.round(t)}ms`;if(t<qe)return`${(t/Ee).toFixed(1)}s`;if(t<Ie){const o=Math.floor(t/qe),d=Math.floor(t%qe/Ee);return`${o}m ${String(d).padStart(2,"0")}s`}const n=Math.floor(t/Ie),i=Math.floor(t%Ie/qe);return`${n}h ${String(i).padStart(2,"0")}m`}function et(t){return typeof t!="number"||!Number.isFinite(t)?null:t.toLocaleString("en-US")}function tt(t,n){if(typeof t!="number"||!Number.isFinite(t))return null;const i=typeof n=="string"&&n.length>0?n.toUpperCase():"USD",o=Math.abs(t)>0&&Math.abs(t)<.01?4:2;try{return new Intl.NumberFormat("en-US",{style:"currency",currency:i,maximumFractionDigits:o}).format(t)}catch{return`${t.toFixed(o)} ${i}`}}function Bt(t){return typeof t!="number"||!Number.isFinite(t)?"unknown":t>=0&&t<=1?`${Math.round(t*100)}%`:String(t)}function xt(t,n){const i=t??{},o=typeof i.completed=="number"&&Number.isFinite(i.completed)?i.completed:0,d=Object.values(i).reduce((a,u)=>typeof u=="number"&&Number.isFinite(u)?a+u:a,0),m=typeof n=="number"&&Number.isFinite(n)&&n>0?n:d,$=m>0?Math.min(100,Math.round(o/m*100)):0;return{completed:o,total:m,percent:$}}var Wt=e.template("<span class=cdt-badge>"),Qt=e.template("<div class=cdt-empty><span class=cdt-empty-title>"),Zt=e.template("<span class=cdt-empty-body>"),Kt=e.template("<div class=cdt-empty role=status aria-live=polite><span class=cdt-empty-body>"),Yt=e.template('<section class=cdt-section><div class="cdt-row cdt-between"><h2 class=cdt-heading>');function ue(t){return(()=>{var n=Wt();return e.insert(n,()=>t.label),e.effect(i=>{var o=t.tone??"unknown",d=t.title??t.label;return o!==i.e&&e.setAttribute(n,"data-tone",i.e=o),d!==i.t&&e.setAttribute(n,"title",i.t=d),i},{e:void 0,t:void 0}),n})()}function $e(t){return(()=>{var n=Qt(),i=n.firstChild;return e.insert(i,()=>t.title),e.insert(n,(()=>{var o=e.memo(()=>!!t.body);return()=>o()?(()=>{var d=Zt();return e.insert(d,()=>t.body),d})():null})(),null),n})()}function Ne(t){return(()=>{var n=Kt(),i=n.firstChild;return e.insert(i,()=>t.label),n})()}function Pe(t){return(()=>{var n=Yt(),i=n.firstChild,o=i.firstChild;return e.insert(o,()=>t.title),e.insert(i,()=>t.aside,null),e.insert(n,()=>t.children,null),n})()}const Jt=`
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
`;var Xt=e.template("<style>"),en=e.template("<p class=cdt-error>Cycle members (not an ordered path): "),tn=e.template('<p class="cdt-muted cdt-meta">Unresolved dependency ids: '),nn=e.template('<div class=cdt-dag-toolbar role=toolbar aria-label="Graph controls"><input class=cdt-dag-search aria-label="Search tasks"placeholder="Search tasks"><select aria-label="Filter by state"><option value>All states</option></select><button type=button aria-label="Zoom in">+</button><button type=button aria-label="Zoom out">-</button><button type=button>Fit</button><button type=button>Reset</button><button type=button>Top to bottom</button><button type=button>Left to right</button><span aria-live=polite> hidden'),rn=e.template('<div class=cdt-dag-canvas role=group aria-label="Task dependency graph. Use arrow keys to pan; hold Space and drag to pan."tabindex=0><div class=cdt-dag-inner style="transform-origin:top left"><svg class=cdt-dag-edges aria-hidden=true><defs><marker markerWidth=7 markerHeight=7 refX=6 refY=3.5 orient=auto><path d="M0,0 L7,3.5 L0,7 z">'),on=e.template('<div class=cdt-dag-overview-wrap><svg class=cdt-dag-overview viewBox="0 0 180 72"role=img aria-label="Graph minimap. Click to navigate; use the task list for keyboard navigation."><rect fill="var(--primary, #8aa8ff)"fill-opacity=.12 stroke="var(--primary, #8aa8ff)"></rect></svg><span class="cdt-muted cdt-meta">Overview. Click to navigate; task list provides keyboard navigation.'),an=e.template('<p class="cdt-muted cdt-meta">Showing <!> in viewport; <!> match filters of <!> total. Edges to filtered or offscreen nodes are hidden.'),ln=e.template("<p> tasks do not match the current search or state. Clear filters to reach them."),sn=e.template("<details class=cdt-dag-list><summary>Accessible task list (<!> matching tasks, <!> total)</summary><div role=list></div><div class=cdt-dag-pagination><button type=button>Previous page</button><span>Page <!> of </span><button type=button>Next page"),dn=e.template("<option>"),cn=e.template("<svg><path class=cdt-dag-edge></svg>",!1,!0,!1),un=e.template("<button type=button class=cdt-dag-node><span class=cdt-dag-title></span><span class=cdt-dag-meta> - "),pn=e.template('<svg><rect width=2 height=2 fill="var(--text-muted, #aaa)"></svg>',!1,!0,!1),gn=e.template("<div role=listitem><button type=button> - "),mn=e.template('<div class="cdt-card cdt-dag-inspector"><div class="cdt-row cdt-between"><strong></strong></div><dl class=cdt-kv><dt>Role</dt><dd></dd><dt>Model slot</dt><dd></dd><dt>Attempts</dt><dd></dd><dt>Latest model</dt><dd></dd><dt>Attempt result</dt><dd></dd><dt>Verification</dt><dd></dd><dt>Acceptance criteria</dt><dd></dd><dt>Findings</dt><dd></dd><dt>Dependencies</dt><dd>'),nt=e.template("<ul>"),hn=e.template("<li>"),fn=e.template("<li> (<!>)"),bn=e.template("<span class=cdt-chips>"),$n=e.template('<button type=button class="cdt-chip cdt-dag-dependency">');const He=100;function vn(t){const n=pe.usePlugin(),i=`cdt-dag-arrow-${r.createUniqueId().replace(/[^a-zA-Z0-9_-]/g,"")}`;let o;const[d,m]=r.createSignal(),[$,a]=r.createSignal(null),[u,g]=r.createSignal(""),[c,f]=r.createSignal(""),[h,_]=r.createSignal(1),[s,S]=r.createSignal({x:20,y:20}),[v,w]=r.createSignal("top-bottom"),[N,j]=r.createSignal({width:700,height:300}),[A,F]=r.createSignal(0),[D,W]=r.createSignal(null),Z=r.createMemo(()=>t.data?.runId??null),K=r.createMemo(()=>L(t.data?.nodes)),Q=r.createMemo(()=>new Map(K().map(l=>[l.id,l]))),U=r.createMemo(()=>zt(t.data?.layers,K().map(l=>l.id),{},v()),void 0,{equals:Tt}),te=r.createMemo(()=>Ot(K(),u(),c()?[c()]:[])),oe=r.createMemo(()=>new Set(Xe(U(),{...s(),scale:h()},N()).map(l=>l.id))),fe=r.createMemo(()=>{const l=U().byId;return L(t.data?.edges).flatMap(x=>{const y=l[x.from],M=l[x.to];return!y||!M||!se().has(x.from)||!se().has(x.to)||!oe().has(x.from)||!oe().has(x.to)?[]:[{...x,key:`${x.from}\0${x.to}`,path:Lt(y,M,v())}]})}),se=r.createMemo(()=>{const l=new Set(te().visible.map(x=>x.id));for(const x of U().nodes)Q().has(x.id)||l.add(x.id);return l}),de=r.createMemo(()=>{const l=se();return Xe(U(),{...s(),scale:h()},N()).filter(x=>l.has(x.id))}),ge=r.createMemo(()=>$()?Q().get($())??null:null),ce=r.createMemo(()=>te().visible.slice(A()*He,(A()+1)*He)),me=r.createMemo(()=>Math.max(0,Math.ceil(te().visible.length/He)-1)),ve=()=>{if(!o)return;const l=Dt({width:o.clientWidth,height:o.clientHeight},U().width,U().height);_(l.scale),S({x:l.x,y:l.y})},ae=l=>{S({x:N().width/2-(l.x+l.width/2)*h(),y:N().height/2-(l.y+l.height/2)*h()})},E=l=>{a(l);const x=U().byId[l];x&&(h()<.65&&_(1),ae(x))},q=(l,x)=>S(y=>({x:y.x+l,y:y.y+x}));return r.createEffect(()=>{Z()&&(a(null),S({x:20,y:20}),_(1),g(""),f(""),F(0))}),r.createEffect(()=>{$()&&!Q().has($())&&a(null),F(l=>Math.min(l,me()))}),r.createEffect(()=>{const l=d();if(!l)return;const x=()=>j({width:l.clientWidth,height:l.clientHeight});x();const y=new ResizeObserver(x);y.observe(l),r.onCleanup(()=>y.disconnect())}),e.createComponent(Pe,{get title(){return n.t("dag.title")},get children(){return[(()=>{var l=Xt();return e.insert(l,Jt),l})(),e.createComponent(r.Show,{get when(){return t.hasRun},get fallback(){return e.createComponent($e,{get title(){return n.t("runs.noSelection")},get body(){return n.t("runs.empty.noSelection")}})},get children(){return e.createComponent(r.Show,{get when(){return t.data},get fallback(){return e.memo(()=>!!t.loading)()?e.createComponent(Ne,{get label(){return n.t("common.loading")}}):null},get children(){return e.createComponent(r.Show,{get when(){return U().nodes.length>0},get fallback(){return e.createComponent($e,{get title(){return n.t("dag.empty.title")},get body(){return n.t("dag.empty.body")}})},get children(){return[e.createComponent(r.Show,{get when(){return L(t.data?.cycles).length>0},get children(){var l=en();return l.firstChild,e.insert(l,()=>L(t.data?.cycles).map(x=>x.join(", ")).join("; "),null),l}}),e.createComponent(r.Show,{get when(){return L(t.data?.dangling).length>0},get children(){var l=tn();return l.firstChild,e.insert(l,()=>L(t.data?.dangling).join(", "),null),l}}),(()=>{var l=nn(),x=l.firstChild,y=x.nextSibling;y.firstChild;var M=y.nextSibling,T=M.nextSibling,p=T.nextSibling,k=p.nextSibling,I=k.nextSibling,G=I.nextSibling,R=G.nextSibling,Y=R.firstChild;return x.$$input=V=>{g(V.currentTarget.value),F(0)},y.addEventListener("change",V=>{f(V.currentTarget.value),F(0)}),e.insert(y,e.createComponent(r.For,{get each(){return[...new Set(K().map(V=>b(V.state,"unknown")))]},children:V=>(()=>{var J=dn();return J.value=V,e.insert(J,V),J})()}),null),M.$$click=()=>_(V=>Math.min(2.5,V*1.2)),T.$$click=()=>_(V=>Math.max(1e-5,V/1.2)),p.$$click=ve,k.$$click=()=>{_(1),S({x:20,y:20})},I.$$click=()=>w("top-bottom"),G.$$click=()=>w("left-right"),e.insert(R,()=>te().hiddenCount,Y),e.effect(V=>{var J=v()==="top-bottom",C=v()==="left-right";return J!==V.e&&e.setAttribute(I,"aria-pressed",V.e=J),C!==V.t&&e.setAttribute(G,"aria-pressed",V.t=C),V},{e:void 0,t:void 0}),e.effect(()=>x.value=u()),e.effect(()=>y.value=c()),l})(),(()=>{var l=rn(),x=l.firstChild,y=x.firstChild,M=y.firstChild,T=M.firstChild;return l.addEventListener("blur",()=>o?.removeAttribute("data-space-pan")),l.$$keyup=p=>{p.key===" "&&p.currentTarget.removeAttribute("data-space-pan")},l.addEventListener("pointercancel",()=>W(null)),l.$$pointerup=p=>{o?.hasPointerCapture(p.pointerId)&&o.releasePointerCapture(p.pointerId),W(null)},l.$$pointermove=p=>{const k=D();if(!k||k.pointerId!==p.pointerId)return;const I=p.clientX-k.px,G=p.clientY-k.py;Math.hypot(I,G)<4||(o?.hasPointerCapture(p.pointerId)||o?.setPointerCapture(p.pointerId),S({x:k.x+I,y:k.y+G}))},l.$$pointerdown=p=>{if(p.target!==p.currentTarget&&!p.currentTarget.hasAttribute("data-space-pan")||p.button!==0)return;const k=s();W({x:k.x,y:k.y,px:p.clientX,py:p.clientY,pointerId:p.pointerId})},l.$$keydown=p=>{if(p.target!==p.currentTarget)return;const k=p.shiftKey?80:30;if(p.key===" "){p.currentTarget.setAttribute("data-space-pan","true"),p.preventDefault();return}if(p.key==="ArrowLeft")q(k,0);else if(p.key==="ArrowRight")q(-k,0);else if(p.key==="ArrowUp")q(0,k);else if(p.key==="ArrowDown")q(0,-k);else if(p.key==="+"||p.key==="=")_(I=>Math.min(2.5,I*1.2));else if(p.key==="-")_(I=>Math.max(1e-5,I/1.2));else return;p.preventDefault()},e.use(p=>{o=p,m(p)},l),e.setAttribute(T,"id",i),e.insert(y,e.createComponent(r.For,{get each(){return fe()},children:p=>(()=>{var k=cn();return e.setAttribute(k,"marker-end",`url(#${i})`),e.effect(I=>{var G=p.resolved?"true":"false",R=p.path;return G!==I.e&&e.setAttribute(k,"data-resolved",I.e=G),R!==I.t&&e.setAttribute(k,"d",I.t=R),I},{e:void 0,t:void 0}),k})()}),null),e.insert(x,e.createComponent(r.For,{get each(){return de()},children:p=>{const k=()=>Q().get(p.id),I=()=>b(k()?.title,p.id),G=()=>b(k()?.state,"unknown");return(()=>{var R=un(),Y=R.firstChild,V=Y.nextSibling,J=V.firstChild;return R.$$click=()=>E(p.id),e.insert(Y,I),e.insert(V,G,J),e.insert(V,()=>b(k()?.role,"unknown"),null),e.effect(C=>{var z=Re(k()?.state),B=k()?.ghost||!k()?"true":"false",le=$()===p.id,O=`${I()}, ${G()}`,H=`${p.x}px`,re=`${p.y}px`,X=`${p.width}px`,_e=`${p.height}px`;return z!==C.e&&e.setAttribute(R,"data-tone",C.e=z),B!==C.t&&e.setAttribute(R,"data-ghost",C.t=B),le!==C.a&&e.setAttribute(R,"aria-pressed",C.a=le),O!==C.o&&e.setAttribute(R,"aria-label",C.o=O),H!==C.i&&e.setStyleProperty(R,"left",C.i=H),re!==C.n&&e.setStyleProperty(R,"top",C.n=re),X!==C.s&&e.setStyleProperty(R,"width",C.s=X),_e!==C.h&&e.setStyleProperty(R,"height",C.h=_e),C},{e:void 0,t:void 0,a:void 0,o:void 0,i:void 0,n:void 0,s:void 0,h:void 0}),R})()}}),null),e.effect(p=>{var k=`${U().width}px`,I=`${U().height}px`,G=`translate(${s().x}px, ${s().y}px) scale(${h()})`,R=U().width,Y=U().height;return k!==p.e&&e.setStyleProperty(x,"width",p.e=k),I!==p.t&&e.setStyleProperty(x,"height",p.t=I),G!==p.a&&e.setStyleProperty(x,"transform",p.a=G),R!==p.o&&e.setAttribute(y,"width",p.o=R),Y!==p.i&&e.setAttribute(y,"height",p.i=Y),p},{e:void 0,t:void 0,a:void 0,o:void 0,i:void 0}),l})(),(()=>{var l=on(),x=l.firstChild,y=x.firstChild;return x.$$click=M=>{const T=M.currentTarget.getBoundingClientRect(),p=(M.clientX-T.left)/T.width*U().width,k=(M.clientY-T.top)/T.height*U().height;let I,G=1/0;for(const R of U().nodes){const Y=Math.hypot(R.x+R.width/2-p,R.y+R.height/2-k);Y<G&&(I=R,G=Y)}I&&ae(I)},e.insert(x,e.createComponent(r.For,{get each(){return U().nodes},children:M=>(()=>{var T=pn();return e.effect(p=>{var k=U().width?M.x/U().width*176:0,I=U().height?M.y/U().height*68:0;return k!==p.e&&e.setAttribute(T,"x",p.e=k),I!==p.t&&e.setAttribute(T,"y",p.t=I),p},{e:void 0,t:void 0}),T})()}),y),e.effect(M=>{var T=Math.max(0,-s().x/h()/Math.max(U().width,1)*176),p=Math.max(0,-s().y/h()/Math.max(U().height,1)*68),k=Math.min(176,N().width/h()/Math.max(U().width,1)*176),I=Math.min(68,N().height/h()/Math.max(U().height,1)*68);return T!==M.e&&e.setAttribute(y,"x",M.e=T),p!==M.t&&e.setAttribute(y,"y",M.t=p),k!==M.a&&e.setAttribute(y,"width",M.a=k),I!==M.o&&e.setAttribute(y,"height",M.o=I),M},{e:void 0,t:void 0,a:void 0,o:void 0}),l})(),(()=>{var l=an(),x=l.firstChild,y=x.nextSibling,M=y.nextSibling,T=M.nextSibling,p=T.nextSibling,k=p.nextSibling;return k.nextSibling,e.insert(l,()=>de().length,y),e.insert(l,()=>te().visible.length,T),e.insert(l,()=>K().length,k),l})(),(()=>{var l=sn(),x=l.firstChild,y=x.firstChild,M=y.nextSibling,T=M.nextSibling,p=T.nextSibling;p.nextSibling;var k=x.nextSibling,I=k.nextSibling,G=I.firstChild,R=G.nextSibling,Y=R.firstChild,V=Y.nextSibling;V.nextSibling;var J=R.nextSibling;return e.insert(x,()=>te().visible.length,M),e.insert(x,()=>K().length,p),e.insert(k,e.createComponent(r.For,{get each(){return ce()},children:C=>(()=>{var z=gn(),B=z.firstChild,le=B.firstChild;return B.$$click=()=>E(C.id),e.insert(B,()=>b(C.title,C.id),le),e.insert(B,()=>b(C.state,"unknown"),null),e.effect(()=>e.setAttribute(B,"aria-current",$()===C.id?"true":void 0)),z})()})),G.$$click=()=>F(C=>Math.max(0,C-1)),e.insert(R,()=>A()+1,V),e.insert(R,()=>me()+1,null),J.$$click=()=>F(C=>Math.min(me(),C+1)),e.insert(l,e.createComponent(r.Show,{get when(){return te().hiddenCount>0},get children(){var C=ln(),z=C.firstChild;return e.insert(C,()=>te().hiddenCount,z),C}}),null),e.effect(C=>{var z=A()===0,B=A()>=me();return z!==C.e&&(G.disabled=C.e=z),B!==C.t&&(J.disabled=C.t=B),C},{e:void 0,t:void 0}),l})(),e.createComponent(r.Show,{get when(){return ge()},children:l=>{const x=()=>t.detail?.tasks.find(p=>p.id===l().id),y=()=>x()?.latestAttempt,M=()=>t.gates?.tasks.find(p=>p.taskId===l().id),T=()=>L(l().dependencies);return(()=>{var p=mn(),k=p.firstChild,I=k.firstChild,G=k.nextSibling,R=G.firstChild,Y=R.nextSibling,V=Y.nextSibling,J=V.nextSibling,C=J.nextSibling,z=C.nextSibling,B=z.nextSibling,le=B.nextSibling,O=le.nextSibling,H=O.nextSibling,re=H.nextSibling,X=re.nextSibling,_e=X.nextSibling,xe=_e.nextSibling,ke=xe.nextSibling,Ae=ke.nextSibling,ie=Ae.nextSibling,ne=ie.nextSibling;return e.insert(I,()=>b(l().title,l().id)),e.insert(k,e.createComponent(ue,{get tone(){return Re(l().state)},get label(){return b(l().state,"unknown")}}),null),e.insert(Y,()=>b(l().role,"unknown")),e.insert(J,()=>b(l().modelSlot,"unknown")),e.insert(z,()=>b(l().attempts,"0")),e.insert(le,(()=>{var ee=e.memo(()=>!!y());return()=>ee()?`${y()?.modelProvider}/${y()?.modelId}${y()?.modelVariant?` (${y()?.modelVariant})`:""}`:"No recorded attempt"})()),e.insert(H,(()=>{var ee=e.memo(()=>!!y());return()=>ee()?`${y()?.state}; exit ${y()?.exitCode??"unknown"}${y()?.failureClass?`; ${y()?.failureClass}`:""}${y()?.startedAt&&y()?.finishedAt&&Number.isFinite(Date.parse(y().finishedAt)-Date.parse(y().startedAt))?`; ${Math.max(0,Date.parse(y().finishedAt)-Date.parse(y().startedAt))} ms`:""}`:"No recorded attempt"})()),e.insert(X,(()=>{var ee=e.memo(()=>M()?.passed===!0);return()=>ee()?"Passed":M()?.passed===!1?"Failed":"No proof recorded"})()),e.insert(xe,(()=>{var ee=e.memo(()=>!!x()?.acceptanceCriteria?.length);return()=>ee()?(()=>{var he=nt();return e.insert(he,e.createComponent(r.For,{get each(){return x().acceptanceCriteria},children:Me=>(()=>{var we=hn();return e.insert(we,Me),we})()})),he})():"Not provided"})()),e.insert(Ae,(()=>{var ee=e.memo(()=>!!M()?.findings.length);return()=>ee()?(()=>{var he=nt();return e.insert(he,e.createComponent(r.For,{get each(){return M().findings},children:Me=>(()=>{var we=fn(),Ke=we.firstChild,Ye=Ke.nextSibling;return Ye.nextSibling,e.insert(we,()=>Me.title,Ke),e.insert(we,()=>Me.status,Ye),we})()})),he})():"No findings recorded"})()),e.insert(ne,(()=>{var ee=e.memo(()=>!!T().length);return()=>ee()?(()=>{var he=bn();return e.insert(he,e.createComponent(r.For,{get each(){return T()},children:Me=>(()=>{var we=$n();return we.$$click=()=>E(Me),e.insert(we,()=>b(Q().get(Me)?.title,Me)),we})()})),he})():"None"})()),p})()}})]}})}})}})]}})}e.delegateEvents(["input","click","keydown","pointerdown","pointermove","pointerup","keyup"]);var xn=e.template("<div class=cdt-inspector-note><strong>Not merge authorization.</strong> Recorded evidence does not authorize a push or merge."),rt=e.template("<ul class=cdt-list>"),wn=e.template("<section class=cdt-section><h3 class=cdt-heading>"),_n=e.template("<section class=cdt-section><h3 class=cdt-heading></h3><ul class=cdt-list>"),yn=e.template("<p>Evidence readiness is unavailable for this server."),Cn=e.template("<ul>"),Sn=e.template("<li>"),Be=e.template('<p class="cdt-muted cdt-meta">'),it=e.template("<span aria-hidden=true>&middot;"),ot=e.template("<span>"),kn=e.template('<li class="cdt-card cdt-card-tight"><div class="cdt-row cdt-between cdt-gap"><span class=cdt-strong></span></div><div class="cdt-row cdt-wrap cdt-meta cdt-muted"><span>: </span><span aria-hidden=true>&middot;</span><time>'),An=e.template("<span class=cdt-label>"),Mn=e.template('<li class=cdt-card><div class="cdt-row cdt-between cdt-gap"><span class=cdt-strong></span></div><div class="cdt-row cdt-wrap cdt-meta cdt-muted"></div><span class=cdt-label>'),Rn=e.template('<span class="cdt-mono cdt-muted">'),Nn=e.template('<li class=cdt-verify><code class=cdt-command></code><div class="cdt-row cdt-wrap cdt-meta"><span class=cdt-muted></span><span class=cdt-muted>'),Pn=e.template("<span class=cdt-mono>"),qn=e.template("<p class=cdt-evidence>"),In=e.template("<p class=cdt-required><span class=cdt-label>"),jn=e.template('<div class=cdt-finding><div class="cdt-row cdt-between cdt-gap"><span class=cdt-strong></span></div><div class="cdt-meta cdt-muted"> · ');function En(t){const n=pe.usePlugin(),i=()=>L(t.data?.approvals),o=()=>L(t.data?.tasks),d=m=>typeof m!="boolean"?n.t("gates.notRun"):m?n.t("gates.passed"):n.t("gates.failed");return e.createComponent(Pe,{get title(){return n.t("gates.title")},get aside(){return e.createComponent(r.Show,{get when(){return t.data},get children(){return e.createComponent(ue,{get tone(){return e.memo(()=>!!t.data?.readiness)()?t.data.readiness.evidenceReady?"completed":"blocked":"unknown"},get label(){return e.memo(()=>!!t.data?.readiness)()?t.data.readiness.evidenceReady?"Evidence ready":"Evidence incomplete":"Evidence readiness unknown"}})}})},get children(){return e.createComponent(r.Show,{get when(){return t.hasRun},get fallback(){return e.createComponent($e,{get title(){return n.t("runs.noSelection")},get body(){return n.t("runs.empty.noSelection")}})},get children(){return e.createComponent(r.Show,{get when(){return t.data},get fallback(){return e.memo(()=>!!t.loading)()?e.createComponent(Ne,{get label(){return n.t("common.loading")}}):null},get children(){return[(()=>{var m=xn(),$=m.firstChild;return $.nextSibling,e.insert(m,e.createComponent(r.Show,{get when(){return t.data?.readiness},get fallback(){return yn()},children:a=>e.createComponent(r.Show,{get when(){return L(a().reasons).length>0},get children(){var u=Cn();return e.insert(u,e.createComponent(r.For,{get each(){return L(a().reasons)},children:g=>(()=>{var c=Sn();return e.insert(c,g),c})()})),u}})}),null),m})(),e.createComponent(r.Show,{get when(){return i().length>0||o().length>0},get fallback(){return e.createComponent($e,{get title(){return n.t("gates.empty.title")},get body(){return n.t("gates.empty.body")}})},get children(){return[(()=>{var m=wn(),$=m.firstChild;return e.insert($,()=>n.t("gates.approvals")),e.insert(m,e.createComponent(r.Show,{get when(){return i().length>0},get fallback(){return(()=>{var a=Be();return e.insert(a,()=>n.t("gates.noApprovals")),a})()},get children(){var a=rt();return e.insert(a,e.createComponent(r.For,{get each(){return i()},children:u=>(()=>{var g=kn(),c=g.firstChild,f=c.firstChild,h=c.nextSibling,_=h.firstChild,s=_.firstChild,S=_.nextSibling,v=S.nextSibling;return e.insert(f,()=>b(u.gate,n.t("common.unknown"))),e.insert(c,e.createComponent(ue,{get tone(){return Gt(u.decision)},get label(){return b(u.decision,n.t("common.unknown"))}}),null),e.insert(_,()=>n.t("gates.actor"),s),e.insert(_,()=>b(u.actor,n.t("common.unknown")),null),e.insert(v,()=>De(u.createdAt)),e.insert(h,e.createComponent(r.Show,{get when(){return u.expiresAt},get children(){return[it(),(()=>{var w=ot();return e.insert(w,()=>n.t("gates.expires",{when:De(u.expiresAt)})),w})()]}}),null),e.effect(()=>e.setAttribute(v,"datetime",b(u.createdAt,""))),g})()})),a}}),null),e.effect(()=>e.setAttribute(m,"aria-label",n.t("gates.approvals"))),m})(),(()=>{var m=_n(),$=m.firstChild,a=$.nextSibling;return e.insert($,()=>n.t("gates.verification")),e.insert(a,e.createComponent(r.For,{get each(){return o()},children:u=>{const g=()=>L(u.verifications),c=()=>L(u.findings);return(()=>{var f=Mn(),h=f.firstChild,_=h.firstChild,s=h.nextSibling,S=s.nextSibling;return e.insert(_,()=>b(u.title,u.taskId)),e.insert(h,e.createComponent(ue,{get tone(){return Re(u.state)},get label(){return b(u.state,n.t("common.unknown"))}}),null),e.insert(s,e.createComponent(r.Show,{get when(){return typeof u.attemptNo=="number"},get children(){return[(()=>{var v=ot();return e.insert(v,()=>n.t("gates.attempt",{no:b(u.attemptNo,"0")})),v})(),it()]}}),null),e.insert(s,e.createComponent(ue,{get tone(){return e.memo(()=>typeof u.passed=="boolean")()?u.passed?"completed":"failed":"pending"},get label(){return d(u.passed)}}),null),e.insert(s,e.createComponent(r.Show,{get when(){return u.blockingFindings>0},get children(){return e.createComponent(ue,{tone:"failed",get label(){return`${b(u.blockingFindings,"0")} ${n.t("gates.blocking")}`}})}}),null),e.insert(s,e.createComponent(r.Show,{get when(){return u.openFindings>0},get children(){return e.createComponent(ue,{tone:"pending",get label(){return`${b(u.openFindings,"0")} ${n.t("gates.open")}`}})}}),null),e.insert(S,()=>n.t("gates.verification")),e.insert(f,e.createComponent(r.Show,{get when(){return g().length>0},get fallback(){return(()=>{var v=Be();return e.insert(v,()=>n.t("gates.noVerifications")),v})()},get children(){var v=rt();return e.insert(v,e.createComponent(r.For,{get each(){return g()},children:w=>(()=>{var N=Nn(),j=N.firstChild,A=j.nextSibling,F=A.firstChild,D=F.nextSibling;return e.insert(j,()=>b(w.command,n.t("common.unknown"))),e.insert(A,e.createComponent(ue,{get tone(){return w.passed?"completed":"failed"},get label(){return e.memo(()=>!!w.passed)()?n.t("gates.passed"):n.t("gates.failed")}}),F),e.insert(F,()=>n.t("gates.exit",{code:b(w.exitCode,"?")})),e.insert(D,()=>vt(w.durationMs)),e.insert(A,e.createComponent(r.Show,{get when(){return w.outputHash},get children(){var W=Rn();return e.insert(W,()=>Fe(w.outputHash,12)),e.effect(()=>e.setAttribute(W,"title",w.outputHash)),W}}),null),e.effect(()=>e.setAttribute(j,"title",w.command)),N})()})),v}}),null),e.insert(f,e.createComponent(r.Show,{get when(){return c().length>0},get children(){return[(()=>{var v=An();return e.insert(v,()=>n.t("gates.findings")),v})(),e.createComponent(r.For,{get each(){return c()},children:v=>(()=>{var w=jn(),N=w.firstChild,j=N.firstChild,A=N.nextSibling,F=A.firstChild;return e.insert(j,()=>b(v.title,n.t("common.unknown"))),e.insert(N,e.createComponent(ue,{get tone(){return v.blocking?"failed":"pending"},get label(){return b(v.severity,n.t("common.unknown"))}}),null),e.insert(A,()=>b(v.category,n.t("common.unknown")),F),e.insert(A,()=>b(v.status,n.t("common.unknown")),null),e.insert(A,e.createComponent(r.Show,{get when(){return v.location},get children(){return[" · ",(()=>{var D=Pn();return e.insert(D,()=>v.location),D})()]}}),null),e.insert(w,e.createComponent(r.Show,{get when(){return v.evidence},get children(){var D=qn();return e.insert(D,()=>Fe(v.evidence,260)),D}}),null),e.insert(w,e.createComponent(r.Show,{get when(){return v.requiredFix},get children(){var D=In(),W=D.firstChild;return e.insert(W,()=>n.t("gates.requiredFix")),e.insert(D,()=>v.requiredFix,null),D}}),null),e.effect(()=>e.setAttribute(w,"data-blocking",v.blocking?"true":"false")),w})()})]}}),null),e.insert(f,e.createComponent(r.Show,{get when(){return c().length===0},get children(){var v=Be();return e.insert(v,()=>n.t("gates.noFindings")),v}}),null),f})()}})),e.effect(()=>e.setAttribute(m,"aria-label",n.t("gates.verification"))),m})()]}})]}})}})}})}var Fn=e.template("<ul class=cdt-list>"),Tn=e.template('<span class="cdt-muted cdt-meta">'),zn=e.template('<span class="cdt-meta cdt-muted">Review reasons: '),Ln=e.template("<span class=cdt-memory-preview>"),On=e.template("<div class=cdt-memory-content>"),Dn=e.template('<li><button type=button class=cdt-memory><span class="cdt-row cdt-between cdt-gap"><span class=cdt-strong></span><span class="cdt-row cdt-gap"><span class="cdt-mono cdt-muted cdt-meta"></span></span></span><span class="cdt-row cdt-wrap cdt-meta cdt-muted"><span>: </span><span aria-hidden=true>&middot;</span><span>: </span><span aria-hidden=true>&middot;</span><span></span></span><span class="cdt-row cdt-wrap cdt-meta"><span>Review: </span><span aria-hidden=true>&middot;</span><span>Eligible: </span></span><span class="cdt-meta cdt-muted">Source run: </span><span class=cdt-label>'),at=e.template('<p class="cdt-muted cdt-meta">'),Un=e.template("<p><strong>Reasons:</strong> "),Gn=e.template("<p><strong>Supersedes:</strong> "),Vn=e.template("<div class=cdt-inspector-review><p><strong>Review classification:</strong> </p><p><strong>Eligibility:</strong> </p><p><strong>Suggested action:</strong> </p><p><strong>Source run:</strong> </p><p><strong>Source artifacts:</strong> </p><p><strong>Actor:</strong> <!> · <strong>Content hash:</strong> "),Hn=e.template("<pre class=cdt-pre tabindex=0>");function Bn(t,n,i,o,d){return!t&&n===i&&o===d}function lt(t){return`${t.label}@${t.version}`}function Wn(t){const n=pe.usePlugin(),[i,o]=r.createSignal(null),[d,m]=r.createSignal({}),[$,a]=r.createSignal({});let u=0,g=!1,c=t.scopeKey;r.createEffect(()=>{c=t.scopeKey,u++,o(null),m({}),a({})}),r.onCleanup(()=>{g=!0,u++});const f=()=>L(t.data?.blocks);async function h(_){const s=lt(_);if(i()===s){o(null);return}if(o(s),Object.prototype.hasOwnProperty.call(d(),s)||$()[s])return;const S=u,v=t.scopeKey;a(N=>({...N,[s]:!0}));let w=null;try{w=await t.loadBlock(b(_.label,""),_.version)}catch{}Bn(g,u,S,t.scopeKey,v)&&(a(N=>({...N,[s]:!1})),m(N=>({...N,[s]:w})))}return e.createComponent(Pe,{get title(){return n.t("memory.title")},get aside(){return(()=>{var _=Tn();return e.insert(_,()=>n.plural("memory.summary",L(t.data?.blocks).length)),_})()},get children(){return e.createComponent(r.Show,{get when(){return f().length>0},get fallback(){return e.memo(()=>!!t.loading)()?e.createComponent(Ne,{get label(){return n.t("common.loading")}}):e.createComponent($e,{get title(){return n.t("memory.empty.title")},get body(){return n.t("memory.empty.body")}})},get children(){var _=Fn();return e.insert(_,e.createComponent(r.For,{get each(){return f()},children:(s,S)=>{const v=()=>lt(s),w=()=>`cdt-memory-content-${S()}`,N=()=>t.scopeKey===c?d()[v()]:null;return(()=>{var j=Dn(),A=j.firstChild,F=A.firstChild,D=F.firstChild,W=D.nextSibling,Z=W.firstChild,K=F.nextSibling,Q=K.firstChild,U=Q.firstChild,te=Q.nextSibling,oe=te.nextSibling,fe=oe.firstChild,se=oe.nextSibling,de=se.nextSibling,ge=K.nextSibling,ce=ge.firstChild;ce.firstChild;var me=ce.nextSibling,ve=me.nextSibling;ve.firstChild;var ae=ge.nextSibling;ae.firstChild;var E=ae.nextSibling;return A.$$click=()=>{h(s)},e.insert(D,()=>b(s.label,n.t("common.unknown"))),e.insert(Z,()=>n.t("memory.version",{version:b(s.version,"0")})),e.insert(W,e.createComponent(ue,{get tone(){return Re(s.status)},get label(){return b(s.status,n.t("common.unknown"))}}),null),e.insert(Q,()=>n.t("memory.scope"),U),e.insert(Q,()=>b(s.scope,n.t("common.unknown")),null),e.insert(oe,()=>n.t("memory.confidence"),fe),e.insert(oe,()=>Bt(s.confidence),null),e.insert(de,(()=>{var q=e.memo(()=>typeof s.reviewAfter=="string");return()=>q()?n.t("memory.reviewAfter",{when:Ht(s.reviewAfter)}):n.t("memory.noReview")})()),e.insert(ce,(()=>{var q=e.memo(()=>s.review?.classification==="unreviewed");return()=>q()?"unreviewed (pending promotion)":b(s.review?.classification,"unknown")})(),null),e.insert(ve,(()=>{var q=e.memo(()=>typeof s.review?.eligible=="boolean");return()=>q()?s.review.eligible?"yes":"no":"unknown"})(),null),e.insert(ae,()=>b(s.sourceRunId,"unknown"),null),e.insert(A,e.createComponent(r.Show,{get when(){return L(s.review?.reasons).length},get children(){var q=zn();return q.firstChild,e.insert(q,()=>L(s.review?.reasons).join(", "),null),q}}),E),e.insert(A,e.createComponent(r.Show,{get when(){return s.contentPreview},get children(){var q=Ln();return e.insert(q,()=>Fe(s.contentPreview,160)),q}}),E),e.insert(E,(()=>{var q=e.memo(()=>i()===v());return()=>q()?n.t("memory.collapse"):n.t("memory.expand")})()),e.insert(j,e.createComponent(r.Show,{get when(){return e.memo(()=>t.scopeKey===c)()&&i()===v()},get children(){var q=On();return e.insert(q,e.createComponent(r.Show,{get when(){return!$()[v()]},get fallback(){return(()=>{var l=at();return e.insert(l,()=>n.t("memory.loading")),l})()},get children(){return e.createComponent(r.Show,{get when(){return N()},get fallback(){return(()=>{var l=at();return e.insert(l,()=>n.t("memory.contentUnavailable")),l})()},children:l=>[(()=>{var x=Vn(),y=x.firstChild,M=y.firstChild;M.nextSibling;var T=y.nextSibling,p=T.firstChild;p.nextSibling;var k=T.nextSibling,I=k.firstChild;I.nextSibling;var G=k.nextSibling,R=G.firstChild;R.nextSibling;var Y=G.nextSibling,V=Y.firstChild;V.nextSibling;var J=Y.nextSibling,C=J.firstChild,z=C.nextSibling,B=z.nextSibling,le=B.nextSibling,O=le.nextSibling;return O.nextSibling,e.insert(y,(()=>{var H=e.memo(()=>l().review?.classification==="unreviewed");return()=>H()?"unreviewed (pending promotion)":b(l().review?.classification??s.review?.classification,"unknown")})(),null),e.insert(T,(()=>{var H=e.memo(()=>typeof(l().review??s.review)?.eligible=="boolean");return()=>H()?(l().review??s.review)?.eligible?"eligible":"not eligible":"unknown"})(),null),e.insert(k,(()=>{var H=e.memo(()=>(l().review??s.review)?.action==="propose_review");return()=>H()?"propose review":b((l().review??s.review)?.action,"unknown")})(),null),e.insert(x,e.createComponent(r.Show,{get when(){return L((l().review??s.review)?.reasons).length},get children(){var H=Un(),re=H.firstChild;return re.nextSibling,e.insert(H,()=>L((l().review??s.review)?.reasons).join(", "),null),H}}),G),e.insert(G,()=>b(l().sourceRunId,"unknown"),null),e.insert(Y,()=>L(l().sourceArtifacts).join(", ")||"unknown",null),e.insert(J,()=>b(l().actor,"unknown"),B),e.insert(J,()=>b(l().contentHash,"unknown"),null),e.insert(x,e.createComponent(r.Show,{get when(){return l().supersedes},get children(){var H=Gn(),re=H.firstChild;return re.nextSibling,e.insert(H,()=>l().supersedes,null),H}}),null),x})(),(()=>{var x=Hn();return e.insert(x,()=>l().content),e.effect(()=>e.setAttribute(x,"aria-label",l().label)),x})()]})}})),e.effect(()=>e.setAttribute(q,"id",w())),q}}),null),e.effect(q=>{var l=i()===v(),x=w();return l!==q.e&&e.setAttribute(A,"aria-expanded",q.e=l),x!==q.t&&e.setAttribute(A,"aria-controls",q.t=x),q},{e:void 0,t:void 0}),j})()}})),_}})}})}e.delegateEvents(["click"]);var st=e.template("<dt>"),Qn=e.template("<dd>"),Zn=e.template("<dd class=cdt-mono>"),Kn=e.template("<dl class=cdt-kv><dt></dt><dd>"),Le=e.template("<span class=cdt-label>"),We=e.template("<ul class=cdt-list>"),Yn=e.template("<pre class=cdt-pre tabindex=0>"),Oe=e.template('<p class="cdt-muted cdt-meta">'),dt=e.template('<li class="cdt-card cdt-card-tight">'),Jn=e.template("<li class=cdt-qa><div class=cdt-qa-question><span class=cdt-muted>: </span></div><p class=cdt-qa-answer><span class=cdt-muted>: ");function Xn(t){const n=pe.usePlugin(),i=()=>b(t.data?.state,n.t("common.unknown")),o=()=>L(t.data?.uncertainties),d=()=>L(t.data?.qaPairs).filter(a=>b(a.question,"").length>0||b(a.answer,"").length>0),m=()=>ft(t.data?.contract),$=()=>b(t.data?.requirementsMarkdown,"");return e.createComponent(Pe,{get title(){return n.t("refinements.title")},get aside(){return e.createComponent(ue,{get tone(){return Re(t.data?.state)},get label(){return i()}})},get children(){return e.createComponent(r.Show,{get when(){return t.hasRun},get fallback(){return e.createComponent($e,{get title(){return n.t("runs.noSelection")},get body(){return n.t("runs.empty.noSelection")}})},get children(){return e.createComponent(r.Show,{get when(){return t.data},get fallback(){return e.memo(()=>!!t.loading)()?e.createComponent(Ne,{get label(){return n.t("common.loading")}}):null},get children(){return[e.createComponent(r.Show,{get when(){return t.data?.state!=="none"},get children(){var a=Kn(),u=a.firstChild,g=u.nextSibling;return e.insert(u,()=>n.t("refinements.state")),e.insert(g,i),e.insert(a,e.createComponent(r.Show,{get when(){return t.data?.outcome},get children(){return[(()=>{var c=st();return e.insert(c,()=>n.t("refinements.outcome")),c})(),(()=>{var c=Qn();return e.insert(c,()=>b(t.data?.outcome,n.t("common.unknown"))),c})()]}}),null),e.insert(a,e.createComponent(r.Show,{get when(){return t.data?.requirementsPath},get children(){return[(()=>{var c=st();return e.insert(c,()=>n.t("refinements.source")),c})(),(()=>{var c=Zn();return e.insert(c,()=>b(t.data?.requirementsPath,"")),c})()]}}),null),a}}),e.createComponent(r.Show,{get when(){return o().length>0},get fallback(){return(()=>{var a=Oe();return e.insert(a,()=>n.t("refinements.noUncertainties")),a})()},get children(){return[(()=>{var a=Le();return e.insert(a,()=>n.t("refinements.uncertainties")),a})(),(()=>{var a=We();return e.insert(a,e.createComponent(r.For,{get each(){return o()},children:u=>(()=>{var g=dt();return e.insert(g,u),g})()})),a})()]}}),(()=>{var a=Le();return e.insert(a,()=>n.t("refinements.qa")),a})(),e.createComponent(r.Show,{get when(){return d().length>0},get fallback(){return(()=>{var a=Oe();return e.insert(a,()=>n.t("refinements.noQa")),a})()},get children(){var a=We();return e.insert(a,e.createComponent(r.For,{get each(){return d()},children:u=>(()=>{var g=Jn(),c=g.firstChild,f=c.firstChild,h=f.firstChild,_=c.nextSibling,s=_.firstChild,S=s.firstChild;return e.insert(f,()=>n.t("refinements.question"),h),e.insert(c,()=>b(u.question,n.t("common.unknown")),null),e.insert(s,()=>n.t("refinements.answer"),S),e.insert(_,()=>b(u.answer,n.t("common.unknown")),null),g})()})),a}}),(()=>{var a=Le();return e.insert(a,()=>n.t("refinements.openQuestions")),a})(),e.createComponent(r.Show,{get when(){return m().length>0},get fallback(){return(()=>{var a=Oe();return e.insert(a,()=>n.t("refinements.noOpenQuestions")),a})()},get children(){var a=We();return e.insert(a,e.createComponent(r.For,{get each(){return m()},children:u=>(()=>{var g=dt();return e.insert(g,u),g})()})),a}}),(()=>{var a=Le();return e.insert(a,()=>n.t("refinements.requirements")),a})(),e.createComponent(r.Show,{get when(){return $().length>0},get fallback(){return(()=>{var a=Oe();return e.insert(a,()=>n.t("refinements.noRequirements")),a})()},get children(){var a=Yn();return e.insert(a,$),e.effect(()=>e.setAttribute(a,"aria-label",n.t("refinements.requirements"))),a}})]}})}})}})}var er=e.template("<span class=cdt-muted>"),Qe=e.template("<ul class=cdt-list>"),ct=e.template("<section class=cdt-section><h3 class=cdt-heading>"),tr=e.template("<section class=cdt-section><h3 class=cdt-heading></h3><dl class=cdt-kv><dt></dt><dd></dd><dt></dt><dd></dd><dt></dt><dd>"),nr=e.template("<ol class=cdt-list>"),rr=e.template('<section class=cdt-section><div class="cdt-row cdt-between"><h3 class=cdt-heading>'),Ze=e.template('<p class="cdt-muted cdt-meta">'),ir=e.template('<li class="cdt-card cdt-card-tight"><div class="cdt-row cdt-between cdt-gap"><span class=cdt-strong></span></div><div class="cdt-mono cdt-meta cdt-muted"></div><div class="cdt-meta cdt-muted">: '),or=e.template("<span aria-hidden=true>&middot;"),ar=e.template("<span>"),lr=e.template('<li class="cdt-card cdt-card-tight"><div class="cdt-row cdt-between cdt-gap"><span class=cdt-strong></span><span class="cdt-muted cdt-meta"></span></div><div class="cdt-mono cdt-meta cdt-muted">/</div><div class="cdt-row cdt-wrap cdt-meta cdt-muted"><span></span><span aria-hidden=true>&middot;</span><span> completed</span><span aria-hidden=true>&middot;</span><span> failed'),sr=e.template('<li class="cdt-card cdt-card-tight"><div class="cdt-row cdt-between cdt-gap"><span class="cdt-mono cdt-strong"></span><span class="cdt-muted cdt-meta"></span></div><div class="cdt-row cdt-wrap cdt-meta cdt-muted"><span>: </span><span aria-hidden=true>&middot;</span><span>: '),ut=e.template("<span class=cdt-mono>"),dr=e.template("<p class=cdt-event-summary>"),cr=e.template('<li class=cdt-event><span class=cdt-event-seq aria-hidden=true></span><div class=cdt-event-body><div class="cdt-row cdt-between cdt-gap"><span class="cdt-strong cdt-mono"></span><time class="cdt-muted cdt-meta"></time></div><div class="cdt-meta cdt-muted">');const ur=120;function pr(t){const n=pe.usePlugin(),i=()=>L(t.data?.assignments),o=()=>L(t.data?.observed),d=()=>L(t.data?.costs.byModel),m=r.createMemo(()=>L(t.timeline?.events).slice().sort((a,u)=>u.sequence-a.sequence).slice(0,ur)),$=()=>(()=>{var a=er();return e.insert(a,()=>n.t("routing.usageUnavailable")),a})();return e.createComponent(Pe,{get title(){return n.t("routing.title")},get children(){return e.createComponent(r.Show,{get when(){return t.hasRun},get fallback(){return e.createComponent($e,{get title(){return n.t("runs.noSelection")},get body(){return n.t("runs.empty.noSelection")}})},get children(){return e.createComponent(r.Show,{get when(){return t.data},get fallback(){return e.memo(()=>!!t.loading)()?e.createComponent(Ne,{get label(){return n.t("common.loading")}}):e.createComponent($e,{get title(){return n.t("routing.empty.title")},get body(){return n.t("routing.empty.body")}})},get children(){return[(()=>{var a=ct(),u=a.firstChild;return e.insert(u,()=>n.t("routing.assignments")),e.insert(a,e.createComponent(r.Show,{get when(){return i().length>0},get fallback(){return(()=>{var g=Ze();return e.insert(g,()=>n.t("routing.noAssignments")),g})()},get children(){var g=Qe();return e.insert(g,e.createComponent(r.For,{get each(){return i()},children:c=>(()=>{var f=ir(),h=f.firstChild,_=h.firstChild,s=h.nextSibling,S=s.nextSibling,v=S.firstChild;return e.insert(_,()=>b(c.role,n.t("common.unknown"))),e.insert(h,e.createComponent(r.Show,{get when(){return c.variant},get children(){return e.createComponent(ue,{tone:"pending",get label(){return b(c.variant,"")}})}}),null),e.insert(s,()=>b(c.model,n.t("common.unknown"))),e.insert(S,()=>n.t("routing.source"),v),e.insert(S,()=>b(c.source,n.t("common.unknown")),null),f})()})),g}}),null),e.effect(()=>e.setAttribute(a,"aria-label",n.t("routing.assignments"))),a})(),(()=>{var a=ct(),u=a.firstChild;return e.insert(u,()=>n.t("routing.observed")),e.insert(a,e.createComponent(r.Show,{get when(){return o().length>0},get fallback(){return(()=>{var g=Ze();return e.insert(g,()=>n.t("routing.noObserved")),g})()},get children(){var g=Qe();return e.insert(g,e.createComponent(r.For,{get each(){return o()},children:c=>(()=>{var f=lr(),h=f.firstChild,_=h.firstChild,s=_.nextSibling,S=h.nextSibling,v=S.firstChild,w=S.nextSibling,N=w.firstChild,j=N.nextSibling,A=j.nextSibling,F=A.firstChild,D=A.nextSibling,W=D.nextSibling,Z=W.firstChild;return e.insert(_,()=>b(c.role,n.t("common.unknown"))),e.insert(s,()=>n.t("routing.attempts",{count:b(c.attempts,"0")})),e.insert(S,()=>b(c.modelProvider,n.t("common.unknown")),v),e.insert(S,()=>b(c.modelId,n.t("common.unknown")),null),e.insert(S,e.createComponent(r.Show,{get when(){return c.modelVariant},get children(){return["/",e.memo(()=>b(c.modelVariant,""))]}}),null),e.insert(N,()=>b(c.modelSlot,n.t("common.unknown"))),e.insert(A,()=>b(c.completed,"0"),F),e.insert(W,()=>b(c.failed,"0"),Z),e.insert(w,e.createComponent(r.Show,{get when(){return typeof c.avgDurationMs=="number"},get children(){return[or(),(()=>{var K=ar();return e.insert(K,()=>n.t("routing.avgDuration",{duration:vt(c.avgDurationMs)})),K})()]}}),null),f})()})),g}}),null),e.effect(()=>e.setAttribute(a,"aria-label",n.t("routing.observed"))),a})(),(()=>{var a=tr(),u=a.firstChild,g=u.nextSibling,c=g.firstChild,f=c.nextSibling,h=f.nextSibling,_=h.nextSibling,s=_.nextSibling,S=s.nextSibling;return e.insert(u,()=>n.t("routing.costs")),e.insert(c,()=>n.t("routing.totalTokens")),e.insert(f,()=>et(t.data?.costs.totalTokens)??$()),e.insert(h,()=>n.t("routing.totalCost")),e.insert(_,()=>tt(t.data?.costs.totalCost,t.data?.costs.currency)??$()),e.insert(s,()=>n.t("routing.coverage")),e.insert(S,()=>n.t("routing.coverageValue",{withUsage:b(t.data?.costs.coverage.withUsage,"0"),attempts:b(t.data?.costs.coverage.attempts,"0")})),e.insert(a,e.createComponent(r.Show,{get when(){return d().length>0},get children(){var v=Qe();return e.insert(v,e.createComponent(r.For,{get each(){return d()},children:w=>(()=>{var N=sr(),j=N.firstChild,A=j.firstChild,F=A.nextSibling,D=j.nextSibling,W=D.firstChild,Z=W.firstChild,K=W.nextSibling,Q=K.nextSibling,U=Q.firstChild;return e.insert(A,()=>b(w.model,n.t("common.unknown"))),e.insert(F,()=>n.t("routing.attempts",{count:b(w.attempts,"0")})),e.insert(W,()=>n.t("routing.totalTokens"),Z),e.insert(W,()=>et(w.tokens)??$(),null),e.insert(Q,()=>n.t("routing.totalCost"),U),e.insert(Q,()=>tt(w.cost,w.currency??t.data?.costs.currency)??$(),null),N})()})),v}}),null),e.effect(()=>e.setAttribute(a,"aria-label",n.t("routing.costs"))),a})(),(()=>{var a=rr(),u=a.firstChild,g=u.firstChild;return e.insert(g,()=>n.t("routing.timeline")),e.insert(u,e.createComponent(r.Show,{get when(){return t.timeline?.truncated},get children(){return e.createComponent(ue,{tone:"pending",get label(){return n.t("routing.truncated")}})}}),null),e.insert(a,e.createComponent(r.Show,{get when(){return m().length>0},get fallback(){return(()=>{var c=Ze();return e.insert(c,()=>n.t("routing.noEvents")),c})()},get children(){var c=nr();return e.insert(c,e.createComponent(r.For,{get each(){return m()},children:f=>(()=>{var h=cr(),_=h.firstChild,s=_.nextSibling,S=s.firstChild,v=S.firstChild,w=v.nextSibling,N=S.nextSibling;return e.insert(_,()=>f.sequence),e.insert(v,()=>b(f.type,n.t("common.unknown"))),e.insert(w,()=>De(f.createdAt)),e.insert(N,()=>b(f.actor,n.t("common.unknown")),null),e.insert(N,e.createComponent(r.Show,{get when(){return f.taskId},get children(){return[" · ",(()=>{var j=ut();return e.insert(j,()=>f.taskId),j})()]}}),null),e.insert(N,e.createComponent(r.Show,{get when(){return f.attemptId},get children(){return[" · ",(()=>{var j=ut();return e.insert(j,()=>Fe(f.attemptId,18)),j})()]}}),null),e.insert(s,e.createComponent(r.Show,{get when(){return f.summary},get children(){var j=dr();return e.insert(j,()=>Fe(f.summary,240)),j}}),null),e.effect(()=>e.setAttribute(w,"datetime",b(f.createdAt,""))),h})()})),c}}),null),e.effect(()=>e.setAttribute(a,"aria-label",n.t("routing.timeline"))),a})()]}})}})}})}var gr=e.template('<div class=cdt-run-counts aria-label="Project run counts"><span><strong></strong> active</span><span><strong></strong> total</span><span><strong></strong> tasks'),mr=e.template('<div class=cdt-run-toolbar><div class=cdt-run-switch role=group aria-label="Run category"><button type=button>Active</button><button type=button>History</button></div><label>Search loaded runs <input type=search></label><label>Sort <select><option value=newest>Newest updated</option><option value=oldest>Oldest updated</option><option value=objective>Objective'),hr=e.template('<p class="cdt-muted cdt-meta">Showing <!> of <!> loaded runs. Search and sort apply to loaded runs only.'),fr=e.template("<div class=cdt-table-scroll><table class=cdt-run-table><thead><tr><th scope=col>Objective</th><th scope=col>State</th><th scope=col>Tasks</th><th scope=col>Attention</th><th scope=col>Updated</th></tr></thead><tbody>"),br=e.template("<button class=cdt-more type=button>"),$r=e.template('<tr><td><button class=cdt-run-link type=button></button><div class="cdt-mono cdt-muted cdt-meta"></div></td><td></td><td>/</td><td></td><td>');function vr(t){const n=pe.usePlugin(),[i,o]=r.createSignal(!0),[d,m]=r.createSignal(""),[$,a]=r.createSignal("newest"),u=r.createMemo(()=>Et(t.runs,i(),d(),$())),g=r.createMemo(()=>t.runs.filter(bt).length);return e.createComponent(Pe,{get title(){return n.t("runs.title")},get children(){return[(()=>{var c=gr(),f=c.firstChild,h=f.firstChild;h.nextSibling;var _=f.nextSibling,s=_.firstChild;s.nextSibling;var S=_.nextSibling,v=S.firstChild;return e.insert(h,()=>t.workspace?.counts.activeRuns??g()),e.insert(f,()=>!t.workspace&&" loaded",null),e.insert(s,()=>t.workspace?.counts.runs??t.runs.length),e.insert(_,()=>!t.workspace&&" loaded",null),e.insert(v,()=>t.workspace?.counts.tasks??"—"),c})(),(()=>{var c=mr(),f=c.firstChild,h=f.firstChild,_=h.nextSibling,s=f.nextSibling,S=s.firstChild,v=S.nextSibling,w=s.nextSibling,N=w.firstChild,j=N.nextSibling;return h.$$click=()=>o(!0),_.$$click=()=>o(!1),v.$$input=A=>m(A.currentTarget.value),j.addEventListener("change",A=>a(A.currentTarget.value)),e.effect(A=>{var F=i(),D=!i();return F!==A.e&&e.setAttribute(h,"aria-pressed",A.e=F),D!==A.t&&e.setAttribute(_,"aria-pressed",A.t=D),A},{e:void 0,t:void 0}),e.effect(()=>v.value=d()),e.effect(()=>j.value=$()),c})(),(()=>{var c=hr(),f=c.firstChild,h=f.nextSibling,_=h.nextSibling,s=_.nextSibling;return s.nextSibling,e.insert(c,()=>u().length,h),e.insert(c,()=>t.runs.length,s),c})(),e.createComponent(r.Show,{get when(){return!t.loading||t.runs.length},get fallback(){return e.createComponent(Ne,{get label(){return n.t("common.loading")}})},get children(){return[e.createComponent(r.Show,{get when(){return u().length},get fallback(){return e.createComponent($e,{get title(){return e.memo(()=>!!t.runs.length)()?"No matching loaded runs":n.t("runs.empty.title")},get body(){return e.memo(()=>!!t.runs.length)()?"Try another filter or load more runs.":n.t("runs.empty.body")}})},get children(){var c=fr(),f=c.firstChild,h=f.firstChild,_=h.nextSibling;return e.insert(_,e.createComponent(r.For,{get each(){return u()},children:s=>{const S=()=>xt(ht(s.counts),s.taskCount);return(()=>{var v=$r(),w=v.firstChild,N=w.firstChild,j=N.nextSibling,A=w.nextSibling,F=A.nextSibling,D=F.firstChild,W=F.nextSibling,Z=W.nextSibling;return N.$$click=()=>t.onSelect(s.id),e.insert(N,()=>s.objective||s.id),e.insert(j,()=>s.id),e.insert(A,e.createComponent(ue,{get tone(){return Re(s.state)},get label(){return s.state}})),e.insert(F,()=>S().completed,D),e.insert(F,()=>S().total,null),e.insert(W,()=>Ft(s)),e.insert(Z,()=>Vt(s.updatedAt)),e.effect(()=>e.setAttribute(N,"aria-label",`Open run: ${s.objective||s.id}`)),v})()}})),c}}),e.createComponent(r.Show,{get when(){return t.nextCursor},get children(){var c=br();return e.addEventListener(c,"click",t.onMore,!0),e.insert(c,()=>t.loadingMore?"Loading…":"Load more runs"),e.effect(()=>c.disabled=t.loadingMore),c}})]}})]}})}e.delegateEvents(["click","input"]);const wt=/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/,xr=/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/,wr=t=>t.split("/").every(n=>wt.test(n)&&!_t.has(n)),_r=/^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._/-]*$/,_t=new Set(["__proto__","constructor","prototype"]);function yr(t,n){const i=[],o=t.agentId.trim(),d=t.model.trim(),m=t.variant.trim(),$=t.steps.trim();wr(o)||i.push("Agent ID must use valid path segments containing letters, numbers, dots, underscores or hyphens."),(!_r.test(d)||d.split("/").some(h=>!h||h==="."||h===".."))&&i.push("Enter a valid provider/model reference without a variant.");const a=Array.isArray(n)?n:[],u=a.find(h=>h.id===d);a.length&&!u&&i.push("Choose a model from the available catalog."),m&&(!wt.test(m)||!u||!Array.isArray(u.variants)||!u.variants.includes(m))&&i.push("Choose a supported variant for the selected model; variants cannot be verified without a catalog.");const g=$?Number($):null;$&&(!/^[1-9]\d*$/.test($)||!Number.isSafeInteger(g))&&i.push("Steps must be a positive whole number.");const c=t.skillIds.split(/\r?\n/).map(h=>h.trim()).filter(Boolean);if(c.some(h=>!xr.test(h)||_t.has(h))&&i.push("Each skill ID must contain only letters, numbers, dots, underscores, colons or hyphens."),["allow","ask","deny"].includes(t.skillEffect)||i.push("Choose a valid skill permission effect."),i.length)return{ok:!1,errors:i};const f={model:m?`${d}#${m}`:d};return g!==null&&(f.steps=g),t.system!==""&&(f.system=t.system),c.length&&(f.permissions=[...new Set(c)].map(h=>({action:"skill",resource:h,effect:t.skillEffect}))),{ok:!0,json:JSON.stringify({$schema:"https://opencode.ai/config.json",agents:{[o]:f}},null,2)}}var Cr=e.template('<p class="cdt-muted cdt-meta">Read-only snapshot. Model slots used by tasks are routing roles, not necessarily the actual model used by an attempt.'),Sr=e.template('<p class="cdt-muted cdt-meta">'),kr=e.template("<div class=cdt-inspector-layout><nav class=cdt-inspector-nav aria-label=Agents>"),Ar=e.template("<section class=cdt-section><h3 class=cdt-heading>Skills</h3><p>"),Mr=e.template(`<details class=cdt-inspector-disclosure><summary>Native configuration guide (read-only examples)</summary><p class=cdt-muted>Examples only; this panel does not save or apply configuration. Replace the placeholder values before using them.</p><h4 class=cdt-subheading>Agent Markdown · .opencode/agents/example.md</h4><pre class=cdt-pre tabindex=0>---
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
}`),pt=e.template("<p class=cdt-inspector-note>"),Rr=e.template("<button type=button>"),Nr=e.template("<div class=cdt-inspector-detail><h3 class=cdt-subheading></h3><div class=cdt-inspector-scroll><table class=cdt-inspector-table><caption class=cdt-sr-only>Agent configuration fields and sources</caption><thead><tr><th scope=col>Field</th><th scope=col>Value</th><th scope=col>Source</th></tr></thead><tbody><tr><th scope=row>Description</th><td></td><td></td></tr><tr><th scope=row>Mode</th><td></td><td></td></tr><tr><th scope=row>Model</th><td></td><td></td></tr><tr><th scope=row>Variant</th><td></td><td></td></tr><tr><th scope=row>Steps</th><td></td><td></td></tr><tr><th scope=row>System prompt</th><td>See disclosure below</td><td></td></tr><tr><th scope=row>Permissions</th><td>See disclosure below</td><td></td></tr></tbody></table></div><details class=cdt-inspector-disclosure><summary>System prompt</summary><pre class=cdt-pre tabindex=0></pre></details><details class=cdt-inspector-disclosure><summary>Permissions JSON</summary><pre class=cdt-pre tabindex=0>"),Pr=e.template("<label>Model <select><option value>Choose a model"),qr=e.template("<h4 class=cdt-subheading>JSONC draft for "),Ir=e.template("<pre class=cdt-pre tabindex=0>"),jr=e.template('<details class="cdt-inspector-disclosure cdt-agent-draft"><summary>Prepare native override</summary><p class=cdt-inspector-note><strong>Draft only; not applied, not saved.</strong> Review in native configuration. This is separate from the snapshot above. Selecting another agent discards this draft.</p><p class="cdt-muted cdt-meta">The snippet contains only the fields entered here. Review existing native configuration and permissions before merging it; replacing them could remove existing settings.</p><div class=cdt-draft-fields><label>Effort / variant <select><option value>No variant override</option></select><span class="cdt-muted cdt-meta"></span></label><label>Steps <input type=number min=1 step=1 inputmode=numeric><span class="cdt-muted cdt-meta">Optional positive whole number.</span></label><label>System prompt <textarea rows=5></textarea><span class="cdt-muted cdt-meta">Leave blank to omit this field. A non-empty system prompt replaces the provider base prompt for this agent.</span></label><label>Skill IDs <textarea rows=3></textarea><span class="cdt-muted cdt-meta">One ID per line. These become permission rules; they do not attach or load skills. Rules are ordered; the last matching rule wins.</span></label><label>Skill permission effect <select><option value=ask>Ask</option><option value=allow>Allow</option><option value=deny>Deny'),Er=e.template('<label>Model reference <input type=text placeholder=provider/model aria-describedby=cdt-draft-model-help><span id=cdt-draft-model-help class="cdt-muted cdt-meta">Model catalog unavailable. Enter a provider/model reference; its availability cannot be verified here.'),Fr=e.template("<option> (<!>)"),Tr=e.template("<option>"),zr=e.template("<div class=cdt-inspector-note role=status><strong>Complete the draft to see JSONC.</strong><ul>"),Lr=e.template("<li>");function Or(t){const n=pe.usePlugin(),[i,o]=r.createSignal(null),d=()=>L(t.data?.agents),m=r.createMemo(()=>d().find(a=>a.id===i())??d()[0]??null),$=(a,u)=>b(ht(a.sources)[u],"unknown");return e.createComponent(Pe,{title:"Configuration",get children(){return e.createComponent(r.Show,{get when(){return t.data},get fallback(){return e.memo(()=>!!t.loading)()?e.createComponent(Ne,{get label(){return n.t("common.loading")}}):e.createComponent($e,{title:"Configuration unavailable"})},get children(){return[Cr(),(()=>{var a=Sr();return e.insert(a,()=>t.data?.nativeResolved?"Native values are resolved by the host; the contributing configuration files are not exposed.":"Native resolution unavailable. Packaged defaults are not asserted to be effective host configuration."),a})(),e.createComponent(r.For,{get each(){return L(t.data?.warnings)},children:a=>(()=>{var u=pt();return e.insert(u,a),u})()}),e.createComponent(r.Show,{get when(){return d().length},get fallback(){return e.createComponent($e,{title:"No agents available",body:"No agent configuration was returned."})},get children(){var a=kr(),u=a.firstChild;return e.insert(u,e.createComponent(r.For,{get each(){return d()},children:g=>(()=>{var c=Rr();return c.$$click=()=>o(g.id),e.insert(c,()=>g.id),e.effect(()=>e.setAttribute(c,"aria-pressed",m()?.id===g.id)),c})()})),e.insert(a,e.createComponent(r.Show,{get when(){return m()},children:g=>(()=>{var c=Nr(),f=c.firstChild,h=f.nextSibling,_=h.firstChild,s=_.firstChild,S=s.nextSibling,v=S.nextSibling,w=v.firstChild,N=w.firstChild,j=N.nextSibling,A=j.nextSibling,F=w.nextSibling,D=F.firstChild,W=D.nextSibling,Z=W.nextSibling,K=F.nextSibling,Q=K.firstChild,U=Q.nextSibling,te=U.nextSibling,oe=K.nextSibling,fe=oe.firstChild,se=fe.nextSibling,de=se.nextSibling,ge=oe.nextSibling,ce=ge.firstChild,me=ce.nextSibling,ve=me.nextSibling,ae=ge.nextSibling,E=ae.firstChild,q=E.nextSibling,l=q.nextSibling,x=ae.nextSibling,y=x.firstChild,M=y.nextSibling,T=M.nextSibling,p=h.nextSibling,k=p.firstChild,I=k.nextSibling,G=p.nextSibling,R=G.firstChild,Y=R.nextSibling;return e.insert(f,()=>g().id),e.insert(c,e.createComponent(r.For,{get each(){return L(g().warnings)},children:V=>(()=>{var J=pt();return e.insert(J,V),J})()}),h),e.insert(j,()=>b(g().description,"Not provided")),e.insert(A,()=>$(g(),"description")),e.insert(W,()=>b(g().mode,"Not provided")),e.insert(Z,()=>$(g(),"mode")),e.insert(U,()=>b(g().model,"Not provided")),e.insert(te,()=>$(g(),"model")),e.insert(se,()=>b(g().variant,"Not provided")),e.insert(de,()=>$(g(),"variant")),e.insert(me,()=>b(g().steps,"Not provided")),e.insert(ve,()=>$(g(),"steps")),e.insert(l,()=>$(g(),"system")),e.insert(T,()=>$(g(),"permissions")),e.insert(I,()=>b(g().system,"Not provided")),e.insert(Y,()=>JSON.stringify(L(g().permissions),null,2)),e.insert(c,e.createComponent(r.Show,{get when(){return g().id},keyed:!0,children:V=>e.createComponent(Dr,{agentId:V,get models(){return t.data?.models}})}),null),c})()}),null),a}}),(()=>{var a=Ar(),u=a.firstChild,g=u.nextSibling;return e.insert(g,()=>b(t.data?.skillPolicy,"Skill policy unavailable.")),a})(),Mr()]}})}})}function Dr(t){const[n,i]=r.createSignal(""),[o,d]=r.createSignal(""),[m,$]=r.createSignal(""),[a,u]=r.createSignal(""),[g,c]=r.createSignal(""),[f,h]=r.createSignal("ask"),_=()=>L(t.models).filter(w=>w&&typeof w.id=="string"&&typeof w.name=="string"&&Array.isArray(w.variants)),s=r.createMemo(()=>_().find(w=>w.id===n())),S=r.createMemo(()=>yr({agentId:t.agentId,model:n(),variant:o(),steps:m(),system:a(),skillIds:g(),skillEffect:f()},_())),v=w=>{i(w),d("")};return(()=>{var w=jr(),N=w.firstChild,j=N.nextSibling,A=j.nextSibling,F=A.nextSibling,D=F.firstChild,W=D.firstChild,Z=W.nextSibling;Z.firstChild;var K=Z.nextSibling,Q=D.nextSibling,U=Q.firstChild,te=U.nextSibling,oe=Q.nextSibling,fe=oe.firstChild,se=fe.nextSibling,de=oe.nextSibling,ge=de.firstChild,ce=ge.nextSibling,me=de.nextSibling,ve=me.firstChild,ae=ve.nextSibling;return e.insert(F,e.createComponent(r.Show,{get when(){return _().length>0},get fallback(){return(()=>{var E=Er(),q=E.firstChild,l=q.nextSibling;return l.$$input=x=>v(x.currentTarget.value),e.effect(()=>l.value=n()),E})()},get children(){var E=Pr(),q=E.firstChild,l=q.nextSibling;return l.firstChild,l.addEventListener("change",x=>v(x.currentTarget.value)),e.insert(l,e.createComponent(r.For,{get each(){return _()},children:x=>(()=>{var y=Fr(),M=y.firstChild,T=M.nextSibling;return T.nextSibling,e.insert(y,()=>x.name,M),e.insert(y,()=>x.id,T),e.effect(()=>y.value=x.id),y})()}),null),e.effect(()=>l.value=n()),E}}),D),Z.addEventListener("change",E=>d(E.currentTarget.value)),e.insert(Z,e.createComponent(r.For,{get each(){return L(s()?.variants)},children:E=>(()=>{var q=Tr();return q.value=E,e.insert(q,E),q})()}),null),e.insert(K,()=>s()?"Only variants listed for this model are available.":"Choose a catalog model to select a supported variant."),te.$$input=E=>$(E.currentTarget.value),se.$$input=E=>u(E.currentTarget.value),ce.$$input=E=>c(E.currentTarget.value),ae.addEventListener("change",E=>h(E.currentTarget.value)),e.insert(w,e.createComponent(r.Show,{get when(){return S().ok},get fallback(){return(()=>{var E=zr(),q=E.firstChild,l=q.nextSibling;return e.insert(l,e.createComponent(r.For,{get each(){return e.memo(()=>!!S().ok)()?[]:S().errors},children:x=>(()=>{var y=Lr();return e.insert(y,x),y})()})),E})()},get children(){return[(()=>{var E=qr();return E.firstChild,e.insert(E,()=>t.agentId,null),E})(),(()=>{var E=Ir();return e.insert(E,(()=>{var q=e.memo(()=>!!S().ok);return()=>q()?S().json:""})()),e.effect(()=>e.setAttribute(E,"aria-label",`JSONC draft for ${t.agentId}`)),E})()]}}),null),e.effect(()=>Z.disabled=!s()||!L(s()?.variants).length),e.effect(()=>Z.value=o()),e.effect(()=>te.value=m()),e.effect(()=>se.value=a()),e.effect(()=>ce.value=g()),e.effect(()=>ae.value=f()),w})()}e.delegateEvents(["click","input"]);var Ur=e.template('<p class="cdt-muted cdt-meta">'),Gr=e.template("<div class=cdt-inspector-scroll><table class=cdt-inspector-table><caption class=cdt-sr-only>Branches and configured policy</caption><tbody><tr><th scope=row>Main branch</th><td></td></tr><tr><th scope=row>Development branch</th><td></td></tr><tr><th scope=row>Repository</th><td></td></tr><tr><th scope=row>Allowed remotes</th><td></td></tr><tr><th scope=row>Allowed targets</th><td></td></tr><tr><th scope=row>Configured operations</th><td></td></tr><tr><th scope=row>Preview providers</th><td></td></tr><tr><th scope=row>Policy source</th><td></td></tr><tr><th scope=row>Policy hash</th><td class=cdt-mono>"),gt=e.template("<ul class=cdt-inspector-list>"),Vr=e.template("<section class=cdt-section><h3 class=cdt-heading>Required checks"),Hr=e.template("<section class=cdt-section><h3 class=cdt-heading>Project verification commands"),Br=e.template("<p>"),Wr=e.template(`<p class="cdt-muted cdt-meta">The host's own permission policy can still ask or deny. This is not a merge rule, branch-protection check, preview result, or candidate-bound approval.`),Qr=e.template("<section class=cdt-section><h3 class=cdt-heading>Current local push guard"),Zr=e.template('<section class=cdt-section><h3 class=cdt-heading>Connected capabilities</h3><div class=cdt-inspector-scroll><table class=cdt-inspector-table><caption class=cdt-sr-only>Provider and executor status</caption><tbody><tr><th scope=row>Preview adapter</th><td></td></tr><tr><th scope=row>Merge executor</th><td></td></tr><tr><th scope=row>Remote protection</th><td></td></tr></tbody></table></div><p class="cdt-muted cdt-meta">Configured providers do not establish a connected provider or a successful preview.'),Kr=e.template("<section class=cdt-section><h3 class=cdt-heading>Release gate sequence</h3><ol class=cdt-inspector-sequence><li>Run required checks.</li><li>Obtain approval to merge the worktree into development and push.</li><li>Verify the deployment for the pushed commit and share its preview URL.</li><li>Obtain the user's preview verification.</li><li>Open or report the development-to-main PR.</li></ol><p class=cdt-muted>This sequence is guidance, not evidence that any step has passed or authorization to perform it."),Yr=e.template("<p class=cdt-inspector-note>"),Jr=e.template("<p class=cdt-muted>No required checks configured in policy."),mt=e.template("<li><code>"),Xr=e.template("<p class=cdt-muted>No verification commands provided."),ei=e.template("<p class=cdt-muted>Branch names are unknown; no branch-specific promise can be made.");function ti(t){const n=pe.usePlugin(),i=o=>L(o).filter(d=>typeof d=="string"&&d.length>0);return e.createComponent(Pe,{title:"Project policy",get children(){return e.createComponent(r.Show,{get when(){return t.data},get fallback(){return e.memo(()=>!!t.loading)()?e.createComponent(Ne,{get label(){return n.t("common.loading")}}):e.createComponent($e,{title:"Project policy unavailable"})},children:o=>[(()=>{var d=Ur();return e.insert(d,()=>b(o().projectRoot,"Project directory unavailable")),d})(),e.createComponent(r.For,{get each(){return L(o().warnings)},children:d=>(()=>{var m=Yr();return e.insert(m,d),m})()}),(()=>{var d=Gr(),m=d.firstChild,$=m.firstChild,a=$.nextSibling,u=a.firstChild,g=u.firstChild,c=g.nextSibling,f=u.nextSibling,h=f.firstChild,_=h.nextSibling,s=f.nextSibling,S=s.firstChild,v=S.nextSibling,w=s.nextSibling,N=w.firstChild,j=N.nextSibling,A=w.nextSibling,F=A.firstChild,D=F.nextSibling,W=A.nextSibling,Z=W.firstChild,K=Z.nextSibling,Q=W.nextSibling,U=Q.firstChild,te=U.nextSibling,oe=Q.nextSibling,fe=oe.firstChild,se=fe.nextSibling,de=oe.nextSibling,ge=de.firstChild,ce=ge.nextSibling;return e.insert(c,()=>b(o().branches?.main,"Unknown")),e.insert(_,()=>b(o().branches?.dev,"Unknown")),e.insert(v,()=>b(o().policy?.repository,"Not configured")),e.insert(j,()=>i(o().policy?.remotes).join(", ")||"Not configured"),e.insert(D,()=>i(o().policy?.targets).join(", ")||"Not configured"),e.insert(K,()=>i(o().policy?.operations).join(", ")||"Not configured"),e.insert(te,()=>i(o().policy?.previewProviders).join(", ")||"Not configured"),e.insert(se,()=>b(o().policySource,"Unknown")),e.insert(ce,()=>b(o().policyHash,"Unavailable")),d})(),(()=>{var d=Vr();return d.firstChild,e.insert(d,e.createComponent(r.Show,{get when(){return i(o().policy?.requiredChecks).length},get fallback(){return Jr()},get children(){var m=gt();return e.insert(m,e.createComponent(r.For,{get each(){return i(o().policy?.requiredChecks)},children:$=>(()=>{var a=mt(),u=a.firstChild;return e.insert(u,$),a})()})),m}}),null),d})(),(()=>{var d=Hr();return d.firstChild,e.insert(d,e.createComponent(r.Show,{get when(){return i(o().verificationCommands).length},get fallback(){return Xr()},get children(){var m=gt();return e.insert(m,e.createComponent(r.For,{get each(){return i(o().verificationCommands)},children:$=>(()=>{var a=mt(),u=a.firstChild;return e.insert(u,$),a})()})),m}}),null),d})(),(()=>{var d=Qr();return d.firstChild,e.insert(d,e.createComponent(r.Show,{get when(){return e.memo(()=>!!o().branches?.main)()&&o().branches?.dev},get fallback(){return ei()},get children(){return[(()=>{var m=Br();return e.insert(m,(()=>{var $=e.memo(()=>o().branches?.main===o().branches?.dev);return()=>$()?`Trunk branch ${o().branches?.main}: direct push is blocked until an authenticated approval adapter exists.`:`Non-force direct pushes to ${o().branches?.dev} are permitted by the branch guard; direct pushes to ${o().branches?.main} and other targets are blocked.`})()),m})(),Wr()]}}),null),d})(),(()=>{var d=Zr(),m=d.firstChild,$=m.nextSibling,a=$.firstChild,u=a.firstChild,g=u.nextSibling,c=g.firstChild,f=c.firstChild,h=f.nextSibling,_=c.nextSibling,s=_.firstChild,S=s.nextSibling,v=_.nextSibling,w=v.firstChild,N=w.nextSibling;return e.insert(h,()=>b(o().capabilities?.previewAdapter,"unknown")),e.insert(S,()=>b(o().capabilities?.mergeExecutor,"unknown")),e.insert(N,()=>b(o().capabilities?.remoteProtection,"unknown")),d})(),Kr()]})}})}var ni=e.template('<div class="cdt-row cdt-wrap cdt-meta"><span></span><span class="cdt-mono cdt-muted">'),ri=e.template("<button class=cdt-back type=button>"),ii=e.template("<div class=cdt-error role=alert><div class=cdt-error-detail>"),oi=e.template("<ol class=cdt-inspector-list>"),ai=e.template("<details class=cdt-inspector-disclosure><summary>Recent plan history (<!>)"),li=e.template("<div class=cdt-root><header class=cdt-header><div class=cdt-title></div><div class=cdt-subtitle>"),si=e.template("<p class=cdt-muted>Legacy or unversioned plan. No revision history is available."),di=e.template("<li><span class=cdt-mono>v</span> <!> <time class=cdt-muted>");const yt=["runs","dag","gates","refinements","memory","routing","agents","project"];function ci(t){return yt.find(n=>n===t)??"runs"}const ui=3e3;function pi(t){const n=pe.usePlugin(),i=()=>n.client.rpc(At),[o,d]=r.createSignal([]),[m,$]=r.createSignal(null),[a,u]=r.createSignal(null),[g,c]=r.createSignal(null),[f,h]=r.createSignal(!0),[_,s]=r.createSignal(null),[S,v]=r.createSignal(!1),[w,N]=r.createSignal(null),[j,A]=r.createSignal(null),[F,D]=r.createSignal(null),[W,Z]=r.createSignal(null),[K,Q]=r.createSignal(null),[U,te]=r.createSignal(null),[oe,fe]=r.createSignal(null),[se,de]=r.createSignal(null),[ge,ce]=r.createSignal(null),[me,ve]=r.createSignal(!0),[ae,E]=r.createSignal(!1),[q,l]=r.createSignal(!0),[x,y]=r.createSignal(null),M=()=>ci(t.tab.id),T=r.createMemo(()=>o().find(C=>C.id===w())??j());let p=0,k=0,I=!1,G=!1;r.onCleanup(()=>{I=!0,p++,k++});async function R(C){try{return Mt(await C())}catch(z){return{data:null,error:z instanceof Error?z.message:String(z)}}}r.createEffect(()=>{t.session.directory,p++,k++,G=!1,d([]),$(null),s(null),v(!1),N(null),A(null),u(null),c(null),h(!0),D(null),Z(null),Q(null),te(null),fe(null),de(null),ce(null),ve(!0),l(!0),y(null)}),r.createEffect(()=>{const C=t.session.directory,z=M(),B=w(),le=p;let O=!0,H=!1;const re=()=>O&&!I&&le===p,X={directory:C};let _e=0,xe=[];y(null),["runs","memory","agents","project"].includes(z)||(D(null),Z(null),Q(null),te(null),de(null),ce(null),E(!!B));async function ke(){if(!(H||!re())){H=!0;try{if(z==="runs"){const[ie,ne,ee]=await Promise.all([R(()=>i().runs({limit:50},{location:X})),R(()=>i().workspace({},{location:X})),R(()=>i().runs({limit:200,states:jt},{location:X}))]);if(!re())return;ve(!1),ie.data&&(d(he=>Ge(L(ie.data?.runs),Ge(L(ee.data?.runs),he))),G||(s(ie.data.nextCursor),G=!0)),ne.data&&$(ne.data),y(ie.error??ne.error??ee.error)}else if(z==="agents"){const ie=await R(()=>i().configuration({},{location:X}));if(!re())return;h(!1),u(ie.data),y(ie.error)}else if(z==="project"){const ie=await R(()=>i().project({},{location:X}));if(!re())return;h(!1),c(ie.data),y(ie.error)}else if(z==="memory"){const ie=await R(()=>i().memory({limit:50},{location:X}));if(!re())return;l(!1),fe(ie.data),y(ie.error)}else if(B){const ie=z==="dag"?[R(()=>i().run({runId:B},{location:X})),R(()=>i().dag({runId:B},{location:X})),R(()=>i().gates({runId:B},{location:X})),R(()=>i().routing({runId:B},{location:X}))]:z==="gates"?[R(()=>i().gates({runId:B},{location:X}))]:z==="refinements"?[R(()=>i().refinements({runId:B},{location:X}))]:[R(()=>i().routing({runId:B},{location:X})),R(()=>i().timeline({runId:B,afterSequence:_e,limit:200},{location:X}))],ne=await Promise.all(ie);if(!re())return;if(E(!1),z==="dag")D(ne[0].data),Z(ne[1].data),Q(ne[2].data),de(ne[3].data),ne[0].data?.summary&&A(ne[0].data.summary);else if(z==="gates")Q(ne[0].data);else if(z==="refinements")te(ne[0].data);else{de(ne[0].data);const ee=ne[1].data;ee&&(xe=[...xe,...L(ee.events)],_e=ee.lastSequence,ce({...ee,events:xe}))}y(ne.find(ee=>ee.error)?.error??null)}}finally{H=!1}}}ke();const Ae=setInterval(()=>{ke()},ui);r.onCleanup(()=>{O=!1,clearInterval(Ae)})});async function Y(){const C=_();if(!C||S())return;const z=p,B=++k,le={directory:t.session.directory};v(!0);const O=await R(()=>i().runs({limit:50,cursor:C},{location:le}));I||z!==p||B!==k||(v(!1),O.data&&(d(H=>Ge(H,L(O.data?.runs))),s(O.data.nextCursor)),y(O.error))}async function V(C,z){if(!C)return null;const B=p,le={directory:t.session.directory},O=await R(()=>i().memoryBlock({label:C,version:z},{location:le}));return I||B!==p?null:O.error?(y(O.error),null):Se(O.data)&&Se(O.data.block)?O.data.block:O.data}function J(C){A(o().find(z=>z.id===C)??null),N(C),n.layout.open(`${n.id}:dag`,t.session)}return(()=>{var C=li(),z=C.firstChild,B=z.firstChild,le=B.nextSibling;return e.insert(B,()=>(m()?.projectRoot??t.session.directory).split("/").filter(Boolean).pop()??n.t("panel.title")),e.insert(le,(()=>{var O=e.memo(()=>!!["runs","memory","agents","project"].includes(M()));return()=>O()?m()?.projectRoot??t.session.directory:T()?.objective??n.t("panel.noRun")})()),e.insert(z,e.createComponent(r.Show,{get when(){return e.memo(()=>!!T())()&&!["runs","memory","agents","project"].includes(M())},get children(){var O=ni(),H=O.firstChild,re=H.nextSibling;return e.insert(O,e.createComponent(ue,{get tone(){return Re(T()?.state)},get label(){return T()?.state??n.t("common.unknown")}}),H),e.insert(H,()=>n.t("runs.progress",{completed:xt(T()?.counts??{},T()?.taskCount??0).completed,total:T()?.taskCount??0})),e.insert(re,w),O}}),null),e.insert(C,e.createComponent(r.Show,{get when(){return!["runs","memory","agents","project"].includes(M())},get children(){var O=ri();return O.$$click=()=>n.layout.open(`${n.id}:runs`,t.session),e.insert(O,()=>n.t("navigation.backRuns")),O}}),null),e.insert(C,e.createComponent(r.Show,{get when(){return x()},get children(){var O=ii(),H=O.firstChild;return e.insert(O,()=>n.t("common.error",{message:x()??""}),H),e.insert(H,()=>n.t("common.retryHint")),O}}),null),e.insert(C,e.createComponent(r.Show,{get when(){return e.memo(()=>M()==="dag")()&&F()},get children(){var O=ai(),H=O.firstChild,re=H.firstChild,X=re.nextSibling;return X.nextSibling,e.insert(H,()=>F()?.planRevisions?.length??0,X),e.insert(O,e.createComponent(r.Show,{get when(){return F()?.planRevisions?.length},get fallback(){return si()},get children(){var _e=oi();return e.insert(_e,e.createComponent(r.For,{get each(){return F()?.planRevisions??[]},children:xe=>(()=>{var ke=di(),Ae=ke.firstChild;Ae.firstChild;var ie=Ae.nextSibling,ne=ie.nextSibling,ee=ne.nextSibling,he=ee.nextSibling;return e.insert(Ae,()=>xe.revision,null),e.insert(ke,()=>xe.reason,ne),e.insert(he,()=>De(xe.createdAt)),e.effect(()=>e.setAttribute(he,"datetime",xe.createdAt)),ke})()})),_e}}),null),O}}),null),e.insert(C,e.createComponent(r.Switch,{get children(){return[e.createComponent(r.Match,{get when(){return M()==="runs"},get children(){return e.createComponent(vr,{get runs(){return o()},get selectedId(){return w()},get loading(){return me()},get workspace(){return m()},get nextCursor(){return _()},get loadingMore(){return S()},onMore:Y,onSelect:J})}}),e.createComponent(r.Match,{get when(){return M()==="dag"},get children(){return e.createComponent(vn,e.mergeProps({get data(){return W()},get loading(){return ae()},get hasRun(){return!!w()}},()=>({detail:F(),gates:K(),routing:se()})))}}),e.createComponent(r.Match,{get when(){return M()==="gates"},get children(){return e.createComponent(En,{get data(){return K()},get loading(){return ae()},get hasRun(){return!!w()}})}}),e.createComponent(r.Match,{get when(){return M()==="refinements"},get children(){return e.createComponent(Xn,{get data(){return U()},get loading(){return ae()},get hasRun(){return!!w()}})}}),e.createComponent(r.Match,{get when(){return M()==="memory"},get children(){return e.createComponent(Wn,{get data(){return oe()},get loading(){return q()},loadBlock:V,get scopeKey(){return t.session.directory}})}}),e.createComponent(r.Match,{get when(){return M()==="routing"},get children(){return e.createComponent(pr,{get data(){return se()},get timeline(){return ge()},get loading(){return ae()},get hasRun(){return!!w()}})}}),e.createComponent(r.Match,{get when(){return M()==="agents"},get children(){return e.createComponent(Or,{get data(){return a()},get loading(){return f()}})}}),e.createComponent(r.Match,{get when(){return M()==="project"},get children(){return e.createComponent(ti,{get data(){return g()},get loading(){return f()}})}})]}}),null),e.effect(()=>e.setAttribute(C,"data-color-mode",n.appearance?.mode?.())),C})()}e.delegateEvents(["click"]);const gi=`
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
`,mi=`
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
`,hi=`
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
.cdt-agent-draft > p { margin:8px 0; }
.cdt-draft-fields { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr)); gap:10px; margin:10px 0; min-width:0; }
.cdt-draft-fields label { display:flex; flex-direction:column; gap:4px; min-width:0; font-weight:600; }
.cdt-draft-fields :is(input,select,textarea) { width:100%; min-width:0; padding:6px 8px; color:inherit; font:inherit; font-weight:400; background:var(--cdt-surface); border:1px solid var(--cdt-border-strong); border-radius:4px; }
.cdt-draft-fields textarea { resize:vertical; }
.cdt-draft-fields select:disabled { opacity:.65; }
.cdt-draft-fields :is(input,select,textarea):focus-visible { outline:2px solid var(--cdt-focus); outline-offset:2px; }
.cdt-draft-fields label span { font-weight:400; }
`,fi={runs:"tab.runs",dag:"tab.dag",gates:"tab.gates",refinements:"tab.refinements",memory:"tab.memory",routing:"tab.routing",agents:"tab.agents",project:"tab.project"},bi=pe.Plugin.define({i18n:{en:{"panel.title":"Conductor","panel.noRun":"No run selected","command.open":"Open Conductor panel","command.description":"Inspect runs, the task graph, gates, refinements, memory and model routing.","tab.runs":"Runs","tab.dag":"DAG","tab.gates":"Gates","tab.refinements":"Refinements","tab.memory":"Memory","tab.routing":"Routing","tab.agents":"Agents","tab.project":"Project","navigation.backRuns":"Back to runs","common.loading":"Loading…","common.unknown":"unknown","common.error":"Could not load data: {{message}}","common.retryHint":"The panel retries every 3 seconds.","runs.title":"Runs","runs.summary.one":"{{count}} run","runs.summary.other":"{{count}} runs","runs.events.one":"{{count}} event","runs.events.other":"{{count}} events","runs.empty.title":"No runs yet","runs.empty.body":"A run appears here once the supervisor starts one in this project.","runs.select":"Select run","runs.risk":"Risk","runs.mode":"Mode","runs.receipt":"receipt","runs.progress":"{{completed}}/{{total}} tasks","runs.updated":"Updated {{when}}","runs.noSelection":"Select a run","runs.empty.noSelection":"Pick a run in the Runs tab to inspect this view.","dag.title":"Task graph","dag.empty.title":"No task graph","dag.empty.body":"This run has no plan or tasks yet.","dag.cycles":"Dependency cycle","dag.dangling":"Unknown dependencies","dag.ghost":"ghost","dag.role":"Role","dag.model":"Model","dag.attempts":"Attempts","dag.layer":"Layer","dag.dependencies":"Dependencies","dag.noDependencies":"No dependencies","dag.hint":"Select a task to see its role, model, attempts and dependencies.","gates.title":"Gates","gates.empty.title":"No gates","gates.empty.body":"This run has no approvals or verification evidence yet.","gates.approvals":"Approvals","gates.noApprovals":"No approvals recorded.","gates.actor":"Actor","gates.expires":"Expires {{when}}","gates.verification":"Verification","gates.noVerifications":"No verification commands recorded.","gates.attempt":"Attempt {{no}}","gates.passed":"passed","gates.failed":"failed","gates.notRun":"not run","gates.exit":"exit {{code}}","gates.findings":"Review findings","gates.noFindings":"No findings.","gates.blocking":"blocking","gates.open":"open","gates.requiredFix":"Required fix","gates.mergeReady":"Merge ready","gates.mergeBlocked":"Merge blocked","refinements.title":"Refinements","refinements.state":"State","refinements.outcome":"Outcome","refinements.source":"Source","refinements.uncertainties":"Uncertainties","refinements.noUncertainties":"No uncertainties recorded.","refinements.qa":"Questions and answers","refinements.noQa":"No questions recorded.","refinements.question":"Question","refinements.answer":"Answer","refinements.openQuestions":"Open questions","refinements.noOpenQuestions":"No open questions.","refinements.requirements":"Requirements","refinements.noRequirements":"No requirements contract.","memory.title":"Memory","memory.summary.one":"{{count}} block","memory.summary.other":"{{count}} blocks","memory.empty.title":"No memory blocks","memory.empty.body":"Project memory appears here once a run records it.","memory.version":"v{{version}}","memory.scope":"Scope","memory.confidence":"Confidence","memory.reviewAfter":"Review after {{when}}","memory.noReview":"No review date","memory.expand":"Show content","memory.collapse":"Hide content","memory.loading":"Loading block…","memory.contentUnavailable":"Content unavailable.","routing.title":"Routing & timeline","routing.empty.title":"No routing data","routing.empty.body":"Routing and events appear after a run starts.","routing.assignments":"Fleet assignments","routing.noAssignments":"No fleet assignments.","routing.source":"Source","routing.observed":"Observed routes","routing.noObserved":"No attempts recorded.","routing.attempts":"{{count}} attempts","routing.avgDuration":"avg {{duration}}","routing.costs":"Cost and usage","routing.totalTokens":"Total tokens","routing.totalCost":"Total cost","routing.coverage":"Usage coverage","routing.coverageValue":"{{withUsage}}/{{attempts}} attempts","routing.usageUnavailable":"usage unavailable","routing.timeline":"Event timeline","routing.truncated":"More events available. Loading the next page on refresh.","routing.noEvents":"No events recorded."}},setup(t){const n=yt.map(i=>({id:i,group:"conductor",closable:"hover",fallback:i==="runs",get title(){return t.t(fi[i])}}));t.add(pe.Panel,{id:"conductor",region:"side",wide:!0,mobile:{get title(){return t.t("panel.title")},order:40,kind:"menu",icon:"terminal"},list:()=>n,render:i=>e.createComponent(pi,{get tab(){return i.tab},get session(){return i.session},get screen(){return i.screen}})}),t.add(pe.Command,()=>({id:"open",title:t.t("command.open"),description:t.t("command.description"),section:"session",run:()=>{const i=t.sessions.current();i&&t.layout.toggle(`${t.id}:runs`,i)}})),t.add(pe.MenuItem,()=>{const i=t.sessions.current();return{menu:"session.panel",id:"open",title:t.t("panel.title"),description:t.t("command.description"),icon:"terminal",order:35,keybind:`${t.id}.open`,opened:!!i&&t.layout.state(`${t.id}:runs`,i)!=="closed",run:()=>{i&&t.layout.open(`${t.id}:runs`,i)}}}),t.add(pe.Style,gi+mi+hi)}});exports.default=bi;
