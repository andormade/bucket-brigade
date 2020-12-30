require('dotenv').config();
const fetch = require('node-fetch');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const AWS = require('aws-sdk');

const ORIGINALS_EXT = '.jpg';

async function getOriginals(s3, extension) {
	return new Promise((resolve, reject) => {
		s3.listObjects({ Bucket: 'candywarehouse' }, function (err, data) {
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

async function downloadOriginal(basePath, key) {
	const response = await fetch(basePath + key);
	const buffer = await response.buffer();
	await fs.mkdir(`.cache/originals/${path.dirname(key)}`, { recursive: true });
	await fs.writeFile(`.cache/originals/${key}`, buffer);
}

async function uploadOptimized(s3, key) {
	const content = await fs.readFile('.cache/optimized/' + path.basename(key));

	return new Promise((resolve, reject) => {
		s3.putObject(
			{
				Bucket: 'candystore',
				Key: key,
				Body: content,
				ACL: 'public-read',
			},
			(err, data) => {
				if (err) {
					console.log(err);
					return reject(err);
				}
				resolve(data);
			}
		);
	});
}

async function optimize() {
	return new Promise((resolve, reject) => {
		exec(
			`npx squoosh-cli --mozjpeg '{quality: 80}' --output-dir .cache/optimized .cache/originals/**/*.jpg`,
			(error, stdout, stderr) => {
				if (error) {
					console.log(`${error.message}`);
					return reject();
				}
				if (stderr) {
					console.log(`${stderr}`);
				}
				console.log(`${stdout}`);
				resolve();
			}
		);
	});
}

(async function () {
	const spacesEndpoint = new AWS.Endpoint('ams3.digitaloceanspaces.com');
	const s3 = new AWS.S3({
		endpoint: spacesEndpoint,
		accessKeyId: process.env.ACCESS_KEY,
		secretAccessKey: process.env.SECRET_KEY,
	});

	const originals = await getOriginals(s3, ORIGINALS_EXT);

	console.log('Downloading originals...');

	await Promise.all(
		originals.map(async original => {
			return await downloadOriginal('https://ams3.digitaloceanspaces.com/candywarehouse/', original.key);
		})
	);

	console.log('Optimizing originals...');

	await optimize();

	console.log('Uploading optimized images...');

	await Promise.all(
		originals.map(async original => {
			return await uploadOptimized(s3, original.key);
		})
	);
})();
