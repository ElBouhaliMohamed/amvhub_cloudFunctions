const functions = require('firebase-functions');
const admin = require('firebase-admin');
try {admin.initializeApp();} catch(e) { console.log('Admin already initialized')} // You do that because the admin SDK can only be initialized once.
const path = require('path');
const os = require('os');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpeg_static = require('ffmpeg-static');
const ffprobe_static = require('ffprobe-static');
const spawn = require('child-process-promise').spawn;

ffmpeg.setFfmpegPath(ffmpeg_static)
ffmpeg.setFfprobePath(ffprobe_static.path)

const SPRITE_MAX_HEIGHT = 120;
const SPRITE_COLS = 10;
const SPRITE_ROWS = 10;
const SPRITE_EVERY_NTH_SECOND = 5;
const SPRITE_PREFIX = 'sprite_';

const runtimeOpts = {
    timeoutSeconds: 540,
    memory: '2GB'
}

function getVideoInfo (inputPath) {
  return new Promise((resolve, reject) => {
    return ffmpeg.ffprobe(inputPath, (error, videoInfo) => {
      if (error) {
        return reject(error);
      }

      console.log(videoInfo)
      const { duration, size } = videoInfo.format;
      let framesPerSecond = '0/0';

      for(stream of videoInfo.streams) {
        framesPerSecond = stream.r_frame_rate
        console.log(`Video framerate is ${framesPerSecond}`)
        if (framesPerSecond !== '0/0') {
          break;
        } 
      }

      return resolve({
        size,
        durationInSeconds: Math.floor(duration),
        framesPerSecond
      });
    });
  });
}

exports = module.exports = functions.runWith(runtimeOpts).storage.object().onFinalize(async (object) => {
  console.log(process.env.FIREBASE_CONFIG);
  console.log('object', JSON.stringify(object));

  // File and directory paths.
  const filePath = object.name;
  const contentType = object.contentType;
  const fileName = path.parse(filePath).name;
  const tempLocalFile = path.join(os.tmpdir(), path.basename(filePath).replace(/ /g, "_"));

  console.log(filePath)

  // Exit if this is triggered on a file that is not an image.
  if (!contentType.startsWith('video/')) {
    return console.log('This is not a video.');
  }

  // Cloud Storage files.
  const bucket = admin.storage().bucket(object.bucket);
  const file = bucket.file(filePath);
  const metadata = {
    contentType: 'image/png',
    // To enable Client-side caching you can set the Cache-Control headers here. Uncomment below.
    'Cache-Control': 'public,max-age=3600'
  };
  
  // Download file from bucket.
  console.log('Downloading File')
  await file.download({destination: tempLocalFile});
  console.log('The file has been downloaded to', tempLocalFile);

  const tempLocalSpriteSheetFolder = os.tmpdir();
  const localSpriteSheetFile = path.join(tempLocalSpriteSheetFolder, `${SPRITE_PREFIX}${fileName}.png`)

  console.log(`Path to ffmpeg ${ffmpeg_static}`)

  const { framesPerSecond } = await getVideoInfo(tempLocalFile);

  await new Promise((resolve, reject) => {
    ffmpeg()
      .input(tempLocalFile)
      .outputOptions(['-frames 1','-q:v 1',`-filter:v select=not(mod(n\\,40)),scale=-1:120,tile=10x10`]) // every 5 seconds
      .output(path.join(tempLocalSpriteSheetFolder, `${SPRITE_PREFIX}${fileName}.png`))
      .on('start', (commandLine) => {
        console.log('Spawned Ffmpeg with command: ' + commandLine);
      })
      .on('progress', (progress) => {
        console.log(`[ffmpeg] ${JSON.stringify(progress)}`);
      })
      .on('error', reject)
      .on('end', resolve)
      .run()
  });

  // console.log('Taking all jpgs and creating the sheet')

  // Generate a thumbnail using ImageMagick.
  // await spawn('identify',[path.join(tempLocalSpriteSheetFolder, `${SPRITE_PREFIX}${fileName}.png`)], {capture: ['stdout', 'stderr']});

  const spriteSheetFolder = path.normalize(path.join('spritesheets', fileName));
  const spriteSheetFilePath = path.normalize(path.join('spritesheets', path.join(fileName, `${SPRITE_PREFIX}${fileName}.png`)));

  const spriteSheetFile = bucket.file(spriteSheetFilePath);
  
  console.log('Spritesheet created at ' + tempLocalSpriteSheetFolder + ' and will be uploaded to ' + spriteSheetFolder);

  // Uploading the Thumbnail.
  await bucket.upload(localSpriteSheetFile, {destination: spriteSheetFile, metadata: metadata});
  console.log('Spritesheet uploaded to Storage at', spriteSheetFolder);
  // Once the image has been uploaded delete the local files to free up disk space.
  fs.unlinkSync(tempLocalFile);
  fs.unlinkSync(localSpriteSheetFile);

  return console.log('Done creating Spritesheet');
});