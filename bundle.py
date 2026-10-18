import json
def read(p):
    return open(p, encoding='utf-8').read()

glyphs = json.load(open('glyphs_meta.json', encoding='utf-8'))
html = f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Liquid.Font — liquid type generator</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&display=swap" rel="stylesheet">
<style>
{read('styles.css')}
</style>
</head>
<body>
{read('body.html')}

<script src="https://cdnjs.cloudflare.com/ajax/libs/opentype.js/1.3.4/opentype.min.js"></script>

<script>
{read('blob-engine.js')}
</script>

<script>
{read('glyph-compose.js')}
</script>

<script>
{read('font-tables.js')}
</script>

<script>
var GLYPH_DATA = {json.dumps(glyphs)};
</script>

<script>
{read('app.js')}
</script>
</body>
</html>
'''
open('index.html', 'w', encoding='utf-8').write(html)
print("wrote index.html", len(html), "bytes")
