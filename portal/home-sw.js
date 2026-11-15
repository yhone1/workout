/* 由 /home-sync.js 通过 importScripts 加载，取得根作用域。 */
const VERSION='20261115-1';
const CACHE='thin-muscle-'+VERSION;
const SHELL=[
  '/','/home/','/home-sync.js','/home-access.js','/media-config.js','/gif-links.js',
  '/portal/manifest.webmanifest','/portal/home-dashboard.js','/portal/home-ai-coach.js','/portal/home-backup.js',
  '/portal/home-library.js','/portal/home-plan-editor.js','/portal/home-exercise-catalog.js',
  '/portal/home-plan.js','/portal/home-progression.js','/portal/home-performance.js','/portal/tabata.js',
  '/portal/shared/training-calendar.js','/portal/shared/training-calendar.css',
  '/portal/shared/theme.css','/portal/shared/home-v2.css',
  '/portal/shared/back-to-top.js','/portal/shared/back-to-top.css',
  '/portal/icons/icon-192.png','/portal/icons/icon-512.png','/portal/icons/icon-maskable-512.png','/portal/icons/apple-touch-icon.png'
];
const STATIC_PREFIXES=['/portal/','/home-sync.js','/home-access.js','/media-config.js','/gif-links.js'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>Promise.allSettled(SHELL.map(url=>cache.add(new Request(url,{cache:'reload'}))))).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;
  if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/IMG/')||url.pathname.startsWith('/VIDEO/')||url.pathname.startsWith('/home/IMG/')||url.pathname.startsWith('/home/VIDEO/')||url.pathname.startsWith('/gym/private'))return;
  if(request.mode==='navigate'){event.respondWith(networkFirst(request,url));return;}
  if(STATIC_PREFIXES.some(prefix=>url.pathname===prefix||url.pathname.startsWith(prefix)))event.respondWith(staleWhileRevalidate(request));
});
// 浏览器磁盘缓存损坏时，缓存条目会返回 304 却读不出响应体。所有取缓存的地方都做可读性校验，
// 失败就当没有缓存，改走网络，避免把坏条目重新交给页面。
async function readCached(cache,request,fallbacks=[]){
  for(const key of [request,...fallbacks]){
    try{
      const cached=await cache.match(key,{ignoreSearch:true});
      if(!cached)continue;
      await cached.clone().arrayBuffer();
      return cached;
    }catch{ /* 条目损坏，尝试下一个候选 */ }
  }
  return null;
}
async function writeCache(cache,request,response){
  try{ await cache.put(request,response.clone()); }catch{ /* 配额或磁盘缓存异常不应影响响应 */ }
}
async function networkFirst(request,url){
  // 导航必须绕过 HTTP 缓存，避免损坏的未版本化文档把旧页面继续交给用户。
  try{
    const response=await fetch(request,{cache:'reload'});
    if(response.ok)await writeCache(await caches.open(CACHE),request,response);
    return response;
  }catch{
    const cache=await caches.open(CACHE);
    const fallback=url.pathname==='/home/'||url.pathname.startsWith('/home/')?'/home/':url.pathname==='/portal/'||url.pathname.startsWith('/portal/')?'/portal/':'/home/';
    return (await readCached(cache,request,[fallback]))||new Response('当前离线，且此页面尚未缓存。',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
  }
}
async function staleWhileRevalidate(request){
  const cache=await caches.open(CACHE);
  const cached=await readCached(cache,request);
  const network=fetch(request,{cache:'reload'}).then(async response=>{
    if(response.ok)await writeCache(cache,request,response);
    return response;
  }).catch(()=>cached);
  return cached||network;
}
