import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { launchNative } from './native-driver.mjs';
const source = await build({
  stdin: {
    contents: `export * from './src/renderer/utils/recursiveExport'; export {paintedCandidateBounds} from './src/renderer/utils/recursivePaintBounds';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'pngTest',
  plugins: [
    {
      name: 'native-konva',
      setup(build) {
        build.onResolve({ filter: /^konva$/ }, () => ({
          path: 'konva',
          namespace: 'native',
        }));
        build.onLoad({ filter: /.*/, namespace: 'native' }, () => ({
          contents: 'export default window.Konva',
        }));
      },
    },
  ],
});
const driver = await launchNative();
try {
  await driver.sync(source.outputFiles[0].text + ';window.pngTest=pngTest;');
  const result = await driver.js(`(async()=>{
    const K=window.Konva;
    const parent=new K.Group({x:237,y:-85,rotation:27,scaleX:-1.3,scaleY:0.7});
    const shape=new K.Rect({x:-12,y:43,width:67,height:83,fill:'red',stroke:'black',strokeWidth:3,shadowBlur:4,shadowOffsetX:2,shadowColor:'black'});
    parent.add(shape);let boundsMaxDelta=0;
    for(const angle of [-120,0,37,90])for(const scale of [-2,0.5,1]){
      shape.rotation(angle);shape.scaleX(scale);
      const actual=pngTest.paintedCandidateBounds(shape),native=shape.getClientRect();
      const m=shape.getAbsoluteTransform().getMatrix();
      const dx=30*(Math.abs(m[0])+Math.abs(m[2])),dy=30*(Math.abs(m[1])+Math.abs(m[3]));
      const expected={x:native.x-dx,y:native.y-dy,width:native.width+2*dx,height:native.height+2*dy};
      for(const key of ['x','y','width','height'])boundsMaxDelta=Math.max(boundsMaxDelta,Math.abs(actual[key]-expected[key]));
    }
    parent.destroy();
    const scene=new K.Group();
    scene.add(new K.Rect({x:1018.25,y:251.25,width:67,height:83,rotation:13,fill:'#5aa',stroke:'#333',strokeWidth:3,shadowColor:'black',shadowBlur:4,shadowOffsetX:2}));
    const clipped=new K.Group({x:2050,y:512,rotation:17,opacity:0.6,clipX:-50,clipY:-30,clipWidth:120,clipHeight:90});
    clipped.add(new K.Circle({radius:90,fill:'#f92'}),new K.Text({x:-80,y:-15,text:'Clipped export',fontSize:24,fill:'black'}));
    scene.add(clipped,new K.Arrow({points:[990,750,2060,760],stroke:'navy',fill:'navy',strokeWidth:3}));
    const bounds={x:0,y:0,width:33001,height:800};
    const bytes=await pngTest.streamPng(scene,bounds);
    // WKWebView cannot decode a single canvas wider than its limit; the PNG
    // decoder validity/dimensions/row ordering are independently tested in Rust.
    const header=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    if(header.getUint32(16)!==bounds.width||header.getUint32(20)!==bounds.height)throw Error('Wide PNG dimensions');
    for(const node of scene.find('Shape'))node.visible(true);
    const compact={x:0,y:0,width:4096,height:1024};
    const streamed=await pngTest.streamPng(scene,compact);
    const image=new Image();const url=URL.createObjectURL(new Blob([streamed],{type:'image/png'}));
    try {
      image.src=url;await image.decode();
      const actual=document.createElement('canvas');actual.width=compact.width;actual.height=compact.height;actual.getContext('2d').drawImage(image,0,0);
      for(const node of scene.find('Shape'))node.visible(true);
      const expected=scene.toCanvas({...compact,pixelRatio:1});const ctx=expected.getContext('2d');ctx.globalCompositeOperation='destination-over';ctx.fillStyle='white';ctx.fillRect(0,0,expected.width,expected.height);
      const a=actual.getContext('2d').getImageData(0,0,actual.width,actual.height).data;
      const b=ctx.getImageData(0,0,expected.width,expected.height).data;
      let differences=0,maxDelta=0;for(let i=0;i<a.length;i++){if(a[i]!==b[i])differences++;maxDelta=Math.max(maxDelta,Math.abs(a[i]-b[i]));}
      actual.width=0;expected.width=0;
      return {wideBytes:bytes.length,compactBytes:streamed.length,differences,maxDelta,boundsMaxDelta};
    }finally{URL.revokeObjectURL(url);scene.destroy();}
  })()`);
  console.log(JSON.stringify(result));
  assert(result.boundsMaxDelta < 1e-7, 'Transformed bounds match native Konva');
  // Different native canvas extents can round antialiased RGB by one level.
  // Larger differences expose clipped shadows or seams (the 2px halo failed).
  assert(
    result.maxDelta <= 1,
    'Tiled PNG pixels must match within one RGB level',
  );
  const id = await driver.native('png:start', 1, 1);
  await assert.rejects(driver.native('png:start', 1, 1), /already active/);
  await driver.native('png:abort', id);
  const next = await driver.native('png:start', 1, 1);
  await driver.native('png:abort', next);
  console.log('Native PNG pixel parity, wide export and cancellation passed.');
} finally {
  await driver.close();
}
