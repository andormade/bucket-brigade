require('dotenv').config();
const { parseStringPromise } = require('xml2js');
const fetch = require('node-fetch');
const fs = require('fs').promises;
const { createReadStream } = require('fs');
const path = require('path');
const { exec } = require('child_process');
const moment = require('moment');
const crypto = require('crypto');

function hmacsha256(key, data) {
	return crypto.createHmac('sha256', key).update(data).digest();
}

function hmacsha256hex(key, data) {
	return crypto.createHmac('sha256', key).update(data).digest('hex');
}

function sha256hex(data) {
	return crypto.createHash('sha256').update(data).digest('hex');
}

async function createContentHash(stream) {
	return new Promise(resolve => {
		const shasum = crypto.createHash('sha256');
		stream.on('data', function (data) {
			shasum.update(data);
		});
		stream.on('end', function () {
			resolve(shasum.digest());
		});
	});
}

const ORIGINALS_EXT = '.jpg';
const { ACCESS_KEY, SERVER_REGION, SECRET_KEY, ORIGINALS_BASEPATH, CDN_BASEPATH, CDN_HOST } = process.env;

function getAuthToken(props) {
	const { method, headers, canonicalURI = '/', canonicalQueryString = '', hashedPayload = '' } = props;

	const date = moment().format('YYYYMMDD');
	const signedHeaders = Object.keys(headers).join(';');
	const canonicalHeaders = Object.keys(headers)
		.map(header => header + '=' + headers[header])
		.join('\n');

	const canonicalRequest =
		method +
		'\n' +
		canonicalURI +
		'\n' +
		canonicalQueryString +
		'\n' +
		canonicalHeaders +
		'\n' +
		signedHeaders +
		'\n' +
		hashedPayload;

	const stringToSign =
		'AWS4-HMAC-SHA256' +
		'\n' +
		moment().format('YYYYMMDDTHHmm') +
		'00Z' +
		'\n' +
		date +
		'/' +
		SERVER_REGION +
		'/s3/aws4_request' +
		'\n' +
		sha256hex(canonicalRequest);

	const dateKey = hmacsha256('AWS4' + SECRET_KEY, date);
	const dateRegionKey = hmacsha256(dateKey, SERVER_REGION);
	const dateRegionServiceKey = hmacsha256(dateRegionKey, 's3');
	const signingKey = hmacsha256(dateRegionServiceKey, 'aws4_request');
	const signature = hmacsha256hex(signingKey, stringToSign);

	return (
		'AWS4-HMAC-SHA256' +
		' ' +
		`Credential=${ACCESS_KEY}/${date}/${SERVER_REGION}/s3/aws4_request,` +
		' ' +
		`SignedHeaders=${signedHeaders},` +
		' ' +
		'Signature=' +
		signature
	);
}

async function getOriginals(basePath, extension) {
	const response = await fetch(basePath);
	const xml = await response.text();
	const json = await parseStringPromise(xml);

	return json.ListBucketResult.Contents.map(obj => ({
		key: obj.Key[0],
		lastModified: obj.LastModified[0],
	})).filter(({ key }) => key.endsWith(extension));
}

async function downloadOriginal(basePath, key) {
	const response = await fetch(basePath + key);
	const buffer = await response.buffer();
	await fs.writeFile(`.cache/${path.basename(key)}`, buffer);
}

async function uploadOptimized(basePath, key) {
	const stream = createReadStream('./optimized/' + path.basename(key));
	//const hash = createContentHash(stream);
	const { size } = await fs.stat('./optimized/' + path.basename(key));

	const headers = {
		'content-length': size,
		'x-amz-acl': 'public-read',
		'content-type': 'image/jpg',
		host: CDN_HOST,
		//'x-amz-content-sha256': hash,
		'x-amz-date': moment().format('YYYYMMDDTHHmm') + '00Z',
	};

	const response = await fetch(basePath + key, {
		method: 'PUT',
		headers: {
			...{
				Authorization: getAuthToken({
					method: 'PUT',
					headers,
					hashedPayload: '',
				}),
			},
			...headers,
		},
		body: stream,
	});

	console.log('response:', response);

	return response;
}

async function optimize() {
	return new Promise((resolve, reject) => {
		exec(`npx squoosh-cli --mozjpeg '{quality: 80}' --output-dir optimized .cache/*.jpg`, (error, stdout, stderr) => {
			if (error) {
				console.log(`${error.message}`);
			}
			if (stderr) {
				console.log(`${stderr}`);
			}
			console.log(`${stdout}`);
			resolve();
		});
	});
}

(async function () {
	const originals = await getOriginals(ORIGINALS_BASEPATH, ORIGINALS_EXT);

	console.log('Downloading originals...');

	await Promise.all(
		originals.map(async original => {
			return await downloadOriginal(ORIGINALS_BASEPATH, original.key);
		})
	);

	console.log('Optimizing originals...');

	await optimize();

	console.log('Uploading optimized images...');

	await Promise.all(
		originals.map(async original => {
			return await uploadOptimized(CDN_BASEPATH, original.key);
		})
	);
})();
