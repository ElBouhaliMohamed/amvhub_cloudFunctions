const functions = require('firebase-functions');
const admin = require('firebase-admin');
try {admin.initializeApp();} catch(e) { console.log('Admin already initialized')} // You do that because the admin SDK can only be initialized once.
const path = require('path');
const os = require('os');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpeg_static = require('ffmpeg-static');

ffmpeg.setFfmpegPath(ffmpeg_static)


// Thumbnail prefix added to file names.
const PREVIEW_PREFIX = 'preview_';

const runtimeOpts = {
    timeoutSeconds: 300,
    memory: '1GB'
}

exports = module.exports = functions.runWith(runtimeOpts).storage.object().onFinalize(async (object) => {
  console.log(process.env.FIREBASE_CONFIG);
  console.log('object', JSON.stringify(object));

  // File and directory paths.
  const filePath = object.name;
  const contentType = object.contentType; // This is the image MIME type
  const fileName = path.parse(filePath).name;
  const fileNameWithType = path.parse(filePath).base;
  const tempLocalFile = path.join(os.tmpdir(), path.basename(filePath).replace(/ /g, "_"));

  // Exit if this is triggered on a file that is not a video.
  if (!contentType.startsWith('video/')) {
    return console.log('This is not a video.');
  }

  if(fileName.startsWith(PREVIEW_PREFIX)) {
      return console.log('This is already a preview.')
  }

  // Cloud Storage files.
  const bucket = admin.storage().bucket(object.bucket);
  const file = bucket.file(filePath);
  const metadata = {
    contentType,
    // To enable Client-side caching you can set the Cache-Control headers here. Uncomment below.
    'Cache-Control': 'public,max-age=3600'
  };
  
  // Download file from bucket.
  console.log('Downloading File')
  await file.download({destination: tempLocalFile});
  console.log('The file has been downloaded to', tempLocalFile);

  const tempLocalPreviewFolder = os.tmpdir();
  const tempLocalPreviewFile = path.join(tempLocalPreviewFolder,`${PREVIEW_PREFIX}${fileNameWithType.replace(/ /g, "_")}`);

  const startTimeInSeconds = 20
  const fragmentDurationInSeconds = 10

  console.log(`Path to ffmpeg ${ffmpeg_static}`)
  await new Promise((resolve, reject) => {
      return ffmpeg()
        .input(tempLocalFile)
        .inputOptions([`-ss ${startTimeInSeconds}`])
        .outputOptions([`-t ${fragmentDurationInSeconds}`])
        .output(tempLocalPreviewFile)
        .on('end', resolve)
        .on('error', reject)
        .run();
  });

  const previewsFolder = path.normalize(path.join('previews', fileName));
  const previewFilePath = path.normalize(path.join('previews', path.join(fileName, `${PREVIEW_PREFIX}${fileNameWithType.replace(/ /g, "_")}`)));

  const previewFile = bucket.file(previewFilePath);

  fs.readdirSync(tempLocalPreviewFolder).forEach(file => {
    console.log(file);
  });
  
  console.log('Preview created at ' + tempLocalPreviewFolder + ' and will be uploaded to ' + previewsFolder);

  // Uploading the Thumbnail.
  await bucket.upload(tempLocalPreviewFile, {destination: previewFilePath, resumable: false, metadata: metadata});
  console.log('Preview uploaded to Storage at', previewsFolder);
  // Once the image has been uploaded delete the local files to free up disk space.
  fs.unlinkSync(tempLocalFile);
  fs.unlinkSync(tempLocalPreviewFile);

  
  // Get the Signed URLs for the thumbnail and original image.
  const config = {
    action: 'read',
    expires: '03-17-2025'
  };
  const results = await Promise.all([
    previewFile.getSignedUrl(config),
  ]);

  console.log('Got Signed URLs.');
  const previewFileResult = results[0];
  const previewFileUrl = previewFileResult[0];

  // Add the URLs to the Database
  await admin.firestore().collection('videos').doc(fileName).update({
      preview: previewFileUrl
  })

  return console.log('Preview successfully created');
});