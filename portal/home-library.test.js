const test=require('node:test'),assert=require('node:assert/strict');
const L=require('./home-library'),M=require('./home-plan');
const catalog=M.catalog([]);
const byId=id=>catalog.find(x=>x.id===id);

test('focus filters map compound labels to every relevant muscle',()=>{
  assert.deepEqual(L.focusIds(byId('chin')),['back','biceps']);
  assert.deepEqual(L.focusIds(byId('face')),['back','shoulders']);
  assert.deepEqual(L.focusIds(byId('lateral')),['shoulders']);
  assert.deepEqual(L.focusIds(byId('bent-calf')),['legs']);
  assert.ok(L.focusIds({focus:'热身',timerType:'timer'}).includes('warmup'));
});

test('catalog filtering combines search, equipment, focus and favorites',()=>{
  assert.ok(L.filterCatalog(catalog,{focus:'chest'}).every(item=>L.focusIds(item).includes('chest')));
  assert.ok(L.filterCatalog(catalog,{equipment:'弹力带'}).every(item=>item.equipment==='弹力带'));
  const searched=L.filterCatalog(catalog,{query:'划船'});
  assert.ok(searched.length>=2);
  assert.ok(searched.every(item=>`${item.name}${item.displayName||''}`.includes('划船')));
  const favorites=L.filterCatalog(catalog,{favorites:['row'],favoritesOnly:true});
  assert.deepEqual(favorites.map(item=>item.id),['row']);
  assert.equal(L.filterCatalog(catalog,{favorites:['row']})[0].id,'row');
});

test('replacement ranking prefers shared focus, equipment and favorites',()=>{
  const target=byId('row');
  const ranked=L.rankReplacements(catalog,target,{favorites:['wide-row'],excludeIds:['face']});
  assert.ok(ranked.length===3);
  assert.equal(ranked[0].item.id,'wide-row');
  assert.match(ranked[0].reason,/同部位/);
  assert.match(ranked[0].reason,/已收藏/);
  assert.ok(!ranked.some(row=>row.item.id==='row'||row.item.id==='face'));
});

test('comparison exposes the metadata that affects a swap',()=>{
  const rows=L.compare(byId('feet-push'),byId('band-push'));
  assert.deepEqual(rows.map(row=>row.label),['动作','器械','部位','记录方式','动作要领']);
  assert.equal(rows[0].left,'脚抬高俯卧撑');
  assert.equal(rows[2].left,'上胸');
  assert.equal(rows[3].left,'次数 / RIR');
  assert.ok(rows[4].right.length>10);
});
