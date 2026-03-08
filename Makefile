version=`cat metadata.json | grep version | tail --lines=1 | awk -e '{print $$2}' | tr -d ',' `


all: publish

publish: extension.js metadata.json
	zip "window-actions-openalo.v$(version).shell-extension.zip" extension.js metadata.json

version:
	echo $(version)
