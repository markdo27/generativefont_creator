import json
glyphs = json.load(open('glyphs_meta.json'))
html = f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Liquid.Font — liquid type generator</title>
<style>
{open('styles.css').read()}
</style>
</head>
<body>
{open('body.html').read()}

<script src="https://cdnjs.cloudflare.com/ajax/libs/opentype.js/1.3.4/opentype.min.js"></script>

<script>
{open('blob-engine.js').read()}
</script>

<script>
var GLYPH_DATA = {json.dumps(glyphs)};
</script>

<script>
{open('app.js').read()}
</script>
</body>
</html>
'''
open('index.html','w').write(html)
print("wrote index.html", len(html), "bytes")
