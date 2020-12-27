import {GifReader, decodeJpeg, decodePng} from "./deps.ts";

interface rawPixelData {
  width: number;
  height: number;
  data: Uint8Array;
}

export async function decodeImageFromPath(path: string){
  let fileData;
  if (path.startsWith("https://") || path.startsWith("http://")) {
    //external file on the internet (requires --allow-net)
    const response = await fetch(path);
    fileData = new Uint8Array(await response.arrayBuffer());
  } else {
    //local file (requires --allow-read)
    fileData = await Deno.readFile(path);
  }

  return await decodeImageFromRawFile(fileData);
}

export async function decodeImageFromRawFile(fileData: Uint8Array){

  const fileType = getFileType(fileData);

  let decodedImage;
  if(fileType === "png"){
    decodedImage = decodePng(fileData);
  }else if(fileType === "jpg"){
    decodedImage = decodeJpeg(fileData);
  }else if(fileType === "gif"){
    decodedImage = decodeGif(fileData);
  }else{
    throw new Error("File type not supported.")
  }
  decodedImage.fileType = fileType;

  return await decodeImageFromRawPixels(decodedImage)
}

export async function decodeImageFromRawPixels(decodedImage:any){
  decodedImage.fileType ??= "raw";
  return setAttributes(decodedImage);

}

function getFileType(rawFile: Uint8Array):string{

  const signatures:{ [key: string]: number[][] }  = {
    "png": [
      [ 137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]
    ],
    "jpg":[
      [ 255, 216, 255, 219 ],
      [ 255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1 ],
      [ 255, 216, 255, 238 ],
      [ 255, 216, 255, 225 ]
    ],
    "gif":[
      [ 71, 73, 70, 56, 55, 97 ],
      [ 71, 73, 70, 56, 57, 97 ]
    ]
  }

  for(const fileType in signatures){
    for(const signature of signatures[fileType]){
      if (
        String(rawFile.slice(0, signature.length)) === String(signature)
      ) {
        return fileType;
      }
    }
  }

  return "unknown";
}


function decodeGif(rawFile:Uint8Array){
  const reader = new GifReader(rawFile);
  const {width, height} = reader;
  const valuesPerPixel = 4;
  const frameSize = width * height * valuesPerPixel;
  const numFrames: number = reader.numFrames();
  const data = new Uint8Array(numFrames * frameSize);
  for(let frameIndex = 0; frameIndex < numFrames; frameIndex++){
    const frameData = data.subarray(frameIndex * frameSize, (frameIndex + 1) * frameSize);
    reader.decodeAndBlitFrameRGBA(frameIndex, frameData);

    //For some reason the gif decoder stores pixels as having values of 0 for r, g, b and a if the pixel value hasn't changed since the last frame. 
    //The lines below replace any all black and transparent pixels with the color of the previous frame. 
    for(let j = 3; j<frameData.length;j+=4){
      if(frameData[j]===0 && frameIndex!=0) {
        frameData[j] = data[(frameIndex - 1)*frameSize+j];
        frameData[j-1] = data[(frameIndex - 1)*frameSize+j-1];
        frameData[j-2] = data[(frameIndex - 1)*frameSize+j-2];
        frameData[j-3] = data[(frameIndex - 1)*frameSize+j-3];
  
      }
    }
  }
  return {data, width, height, numFrames, frameSize, valuesPerPixel};
}


export function setAttributes(decodedImage:any){
  decodedImage.fileType ??= "unknown";
  decodedImage.numFrames ??= 1;
  decodedImage.totalPixels = decodedImage.width * decodedImage.height * decodedImage.numFrames;
  decodedImage.valuesPerPixel ??= decodedImage.totalPixels * 4 <= decodedImage.data.length ? 4 : decodedImage.totalPixels * 3 <= decodedImage.data.length ? 3 : 1;
  decodedImage.frameSize ??= decodedImage.valuesPerPixel * decodedImage.width * decodedImage.height;

  decodedImage.getFrameData = function (frameIndex:number=0){
    return this.data.subarray(frameIndex * this.frameSize, (frameIndex + 1) * this.frameSize);

  }
  decodedImage.getPixel = function (x: number, y: number, frameIndex:number=0) {
    const frameData = this.getFrameData(frameIndex);
    const index = x + (y * this.width);
    let pixelData;

    //with transparency values
    if (this.valuesPerPixel === 4) {
      pixelData = {
        r: frameData[index * 4],
        g: frameData[index * 4 + 1],
        b: frameData[index * 4 + 2],
        a: frameData[index * 4 + 3],
      };

      //no transparency values
    } else if (this.valuesPerPixel === 3) {
      pixelData = {
        r: frameData[index * 3],
        g: frameData[index * 3 + 1],
        b: frameData[index * 3 + 2],
      };
      //grayscale
    } else {
      pixelData = {
        r: frameData[index],
        g: frameData[index],
        b: frameData[index],
      };
    }
    return pixelData;
  };

  return decodedImage;
}