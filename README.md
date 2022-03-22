# bucket-brigade

You can use this tool to take files from an Amazon S3 (or compatible) bucket, transform them with a specified command, and then upload them into an other S3 compatible bucket.

The example works with imagemagick which uses the fuse filesystem, but in order to enable it in docker, you have to run the container with the following arguments:

    docker run --privileged --cap-add SYS_ADMIN --device /dev/fuse bucket-brigade
