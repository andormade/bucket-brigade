require('dotenv').config();
const fetch = require('node-fetch');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const AWS = require('aws-sdk');

const ORIGINALS_EXT = '.jpg';

async function getOriginals(s3, extension) {
	return new Promise((resolve, reject) => {
		s3.listObjects({ Bucket: process.env.SOURCE_BUCKET }, function (err, data) {
			if (err) {
				return reject(err);
			}
			resolve(
				data['Contents']
					.map(({ Key, LastModified }) => ({
						key: Key,
						lastModified: LastModified,
					}))
					.filter(({ key }) => key.endsWith(extension))
			);
		});
	});
}

async function downloadOriginal(s3, key) {
	return new Promise((resolve, reject) => {
		s3.getObject({ Bucket: process.env.SOURCE_BUCKET, Key: key }, async (err, data) => {
			if (err) {
				console.log(err);
				return reject(err);
			}

			await fs.mkdir(`.cache/originals/${path.dirname(key)}`, { recursive: true });
			await fs.writeFile(`.cache/originals/${key}`, data.Body);
			console.log(key, 'done');
			resolve();
		});
	});
}

async function uploadOptimized(s3, key, ContentType = 'image/jpg') {
	const content = await fs.readFile('.cache/optimized/' + key);

	return new Promise((resolve, reject) => {
		s3.putObject(
			{
				Bucket: process.env.DESTINATION_BUCKET,
				Key: key,
				Body: content,
				ACL: 'public-read',
				ContentType,
			},
			(err, data) => {
				if (err) {
					console.log(err);
					return reject(err);
				}
				console.log(key, 'done');
				resolve(data);
			}
		);
	});
}

async function optimize(key) {
	await fs.mkdir(`.cache/optimized/${path.dirname(key)}`, { recursive: true });
	return new Promise((resolve, reject) => {
		exec(
			`./magick convert .cache/originals/${key} -resize 1500x1500 -quality 80 .cache/optimized/${key}`,
			(error, stdout, stderr) => {
				if (error) {
					console.log(`${error.message}`);
					return reject();
				}
				if (stderr) {
					console.log(`${stderr}`);
				}
				if (stdout) {
					console.log(`${stdout}`);
				}
				resolve();
				console.log(key, 'done');
			}
		);
	});
}

(async function () {
	const spacesEndpoint = new AWS.Endpoint(process.env.AWS_ENDPOINT);
	const s3 = new AWS.S3({
		endpoint: spacesEndpoint,
		accessKeyId: process.env.ACCESS_KEY,
		secretAccessKey: process.env.SECRET_KEY,
	});

	const originals = await getOriginals(s3, ORIGINALS_EXT);

	console.log('Downloading originals...');

	for (let i = 0; i < originals.length; i++) {
		await downloadOriginal(s3, originals[i].key);
	}

	console.log('Optimizing originals...');

	for (let i = 0; i < originals.length; i++) {
		await optimize(originals[i].key);
	}

	console.log('Uploading optimized images...');

	for (let i = 0; i < originals.length; i++) {
		await uploadOptimized(s3, originals[i].key);
	}
})();
