import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';
const source = await readFile(new URL('../src/lib/authoring-templates.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {builtInTemplates,loadTemplates,saveTemplates,validateTemplates} = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const template = {id:'custom',name:'常用',mode:'edit',text:'保留内容并润色'};
test('presets cover three modes and fit requirement bounds',()=>{
 assert.equal(builtInTemplates.length,9);
 for(const mode of ['edit','new','cards']) assert.equal(builtInTemplates.filter(t=>t.mode===mode).length,3);
 assert.deepEqual(validateTemplates(builtInTemplates),builtInTemplates);
});
test('custom templates roundtrip and persistence failure preserves prior data',()=>{
 let stored = null;
 globalThis.localStorage = {getItem:()=>stored,setItem:(_,v)=>{stored=v;}};
 assert.deepEqual(loadTemplates(),[]);
 saveTemplates([template]);
 assert.deepEqual(loadTemplates(),[template]);
 const before=stored;
 localStorage.setItem=()=>{throw new Error('quota');};
 assert.throws(()=>saveTemplates([]),/quota/);
 assert.equal(stored,before);
});
test('invalid custom templates are rejected without writing',()=>{
 globalThis.localStorage={getItem:()=>'{broken',setItem:()=>{throw new Error('must not write');}};
 assert.throws(()=>loadTemplates());
 for(const value of [null,{},Array(31).fill(template),[template,template],[{...template,name:''}],[{...template,text:'x'.repeat(6001)}],[{...template,mode:'unknown'}]]) assert.throws(()=>validateTemplates(value));
});
