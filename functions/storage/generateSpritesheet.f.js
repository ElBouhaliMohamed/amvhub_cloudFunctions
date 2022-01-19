const functions = require('firebase-functions');
const admin = require('firebase-admin');
try {
  admin.initializeApp();
} catch (e) {
  console.log('Admin already initialized');
} // You do that because the admin SDK can only be initialized once.
const path = require('path');
const os = require('os');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpeg_static = require('ffmpeg-static');
const ffprobe_static = require('ffprobe-static');
const gm = require('gm').subClass({ imageMagick: true });
const { v4: uuidv4 } = require('uuid');

ffmpeg.setFfmpegPath(ffmpeg_static);
ffmpeg.setFfprobePath(ffprobe_static.path);

const SPRITE_PREFIX = 'sprite_';
const PREVIEW_PREFIX = 'preview_';

const FILETYPE = 'webp';

const runtimeOpts = {
  timeoutSeconds: 540,
  memory: '2GB',
};

function getVideoInfo(inputPath) {
  return new Promise((resolve, reject) => {
    return ffmpeg.ffprobe(inputPath, (error, videoInfo) => {
      if (error) {
        return reject(error);
      }

      console.log(videoInfo);
      const { duration, size } = videoInfo.format;
      let framesPerSecond = '0/0';

      for (stream of videoInfo.streams) {
        framesPerSecond = stream.r_frame_rate;
        console.log(`Video framerate is ${framesPerSecond}`);
        if (framesPerSecond !== '0/0') {
          break;
        }
      }

      return resolve({
        size,
        durationInSeconds: Math.floor(duration),
        framesPerSecond,
      });
    });
  });
}

exports = module.exports = functions
  .runWith(runtimeOpts)
  .storage.object()
  .onFinalize(async (object) => {
    console.log(process.env.FIREBASE_CONFIG);
    console.log('object', JSON.stringify(object));

    // File and directory paths.
    const filePath = object.name;
    const contentType = object.contentType;
    const fileName = path.parse(filePath).name;
    const workingDir = path.join(os.tmpdir(), 'spritesheets');
    const tempLocalFile = path.join(
      workingDir,
      path.basename(filePath).replace(/ /g, '_')
    );
    if (!fs.existsSync(workingDir)) {
      fs.mkdirSync(workingDir);
    }

    // Exit if this is triggered on a file that is not an image.
    if (!contentType.startsWith('video/')) {
      return console.log('This is not a video.');
    }

    if (fileName.startsWith(PREVIEW_PREFIX)) {
      return console.log('This is a preview so no need for a spritesheet.');
    }

    // Cloud Storage files.
    const uuid = uuidv4();
    const bucket = admin.storage().bucket(object.bucket);
    const file = bucket.file(filePath);
    const metadata = {
      contentType: `image/${FILETYPE}`,
      // To enable Client-side caching you can set the Cache-Control headers here. Uncomment below.
      'Cache-Control': 'public,max-age=3600',
      metadata: {
        firebaseStorageDownloadTokens: uuid,
      },
    };

    // Download file from bucket.
    console.log('Downloading File to', tempLocalFile);
    await file.download({
      validation: !process.env.FUNCTIONS_EMULATOR,
      destination: tempLocalFile,
    });
    console.log('The file has been downloaded to', tempLocalFile);

    const tempLocalSpriteSheetFolder = workingDir;
    const localSpriteSheetFile = path.join(
      tempLocalSpriteSheetFolder,
      `${SPRITE_PREFIX}${fileName}.${FILETYPE}`
    );

    console.log(`Path to ffmpeg ${ffmpeg_static}`);

    const { durationInSeconds } = await getVideoInfo(tempLocalFile);

    const SPRITE_EVERY_NTH_SECOND = 5;
    const SPRITE_HEIGHT = 120;
    const SPRITE_COLS = 10;
    const SPRITE_ROWS = Math.round(
      durationInSeconds / SPRITE_EVERY_NTH_SECOND / SPRITE_COLS
    );

    console.log(
      `Taking a frame every ${SPRITE_EVERY_NTH_SECOND} with ${SPRITE_COLS}x${SPRITE_ROWS}`
    );

    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(tempLocalFile)
        .outputOptions([
          '-frames 1',
          '-q:v 1',
          `-filter:v fps=1/${SPRITE_EVERY_NTH_SECOND},scale=-1:${SPRITE_HEIGHT},tile=${SPRITE_COLS}x${SPRITE_ROWS}`,
        ]) // every second
        .output(
          path.join(
            tempLocalSpriteSheetFolder,
            `${SPRITE_PREFIX}${fileName}.${FILETYPE}`
          )
        )
        .on('start', (commandLine) => {
          console.log('Spawned Ffmpeg with command: ' + commandLine);
        })
        .on('progress', (progress) => {
          console.log(`[ffmpeg] ${JSON.stringify(progress)}`);
        })
        .on('error', function (err, stdout, stderr) {
          if (err) {
            console.log('[ffmpeg] ' + err.message);
            console.log('[ffmpeg] stdout:\n' + stdout);
            console.log('[ffmpeg] stderr:\n' + stderr);
            reject('Error');
          }
        })
        .on('end', resolve)
        .run();
    });

    // console.log('Taking all jpgs and creating the sheet')
    let spriteSheetWidth = 0;
    // Generate a thumbnail using ImageMagick.
    await new Promise((resolve, reject) => {
      gm(
        path.join(
          tempLocalSpriteSheetFolder,
          `${SPRITE_PREFIX}${fileName}.${FILETYPE}`
        )
      ).size((err, value) => {
        if (err) reject(err);
        console.log(err, value);
        spriteSheetWidth = value.width;
        resolve();
      });
    });

    const SPRITE_WIDTH = spriteSheetWidth / SPRITE_COLS;

    // await spawn('identify',[path.join(tempLocalSpriteSheetFolder, `${SPRITE_PREFIX}${fileName}.${FILETYPE}`)], {capture: ['stdout', 'stderr']});

    const spriteSheetFolder = path.normalize(
      path.join('spritesheets', fileName)
    );
    const spriteSheetFilePath = path.normalize(
      path.join(
        'spritesheets',
        path.join(fileName, `${SPRITE_PREFIX}${fileName}.${FILETYPE}`)
      )
    );

    const spriteSheetFile = bucket.file(spriteSheetFilePath);

    console.log(
      'Spritesheet created at ' +
        tempLocalSpriteSheetFolder +
        ' and will be uploaded to ' +
        spriteSheetFolder
    );

    // Uploading the Thumbnail.
    await bucket.upload(localSpriteSheetFile, {
      destination: spriteSheetFile,
      resumable: false,
      metadata: metadata,
    });
    console.log('Spritesheet uploaded to Storage at', spriteSheetFolder);
    // Once the image has been uploaded delete the local files to free up disk space.
    fs.unlinkSync(tempLocalFile);
    fs.unlinkSync(localSpriteSheetFile);

    const bucketName = 'amvhub-83826.appspot.com';
    const encodedPath = encodeURIComponent(spriteSheetFilePath);
    const spriteSheetFileUrl = `${
      process.env.FUNCTIONS_EMULATOR
        ? 'http://localhost:9199'
        : 'https://firebasestorage.googleapis.com'
    }/v0/b/${bucketName}/o/${encodedPath}?alt=media&token=${uuid}`;

    // Add the URLs to the Database
    await admin.firestore().collection('videos').doc(fileName).update({
      spriteSheet: spriteSheetFileUrl,
      spriteWidth: SPRITE_WIDTH,
      spriteHeight: SPRITE_HEIGHT,
    });

    return console.log(
      'Done creating Spritesheet and saving it to the database'
    );
  });
