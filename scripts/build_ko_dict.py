"""en-from-ko.jsonl -> out/ko_dict.jsonl, out/ko_dict.sql, out/irregular.json
usage: python -I build_ko_dict.py <en-from-ko.jsonl> <out_dir>
"""
import sys, json, os, re
src, out = sys.argv[1], sys.argv[2]
POS = {'noun':'명사','verb':'동사','adj':'형용사','adv':'부사','prep':'전치사','pron':'대명사',
       'conj':'접속사','intj':'감탄사','num':'수사','det':'한정사','phrase':'구','name':'고유명사'}
MAX_SENSES, MAX_LEN = 3, 90
words = {}
with open(src, encoding='utf-8') as f:
    for line in f:
        d = json.loads(line)
        w = d['word']
        if not re.fullmatch(r"[A-Za-z][A-Za-z'\- ]*", w): continue
        key = w.lower()
        gl = []
        for g in d['glosses']:
            g = re.sub(r'\s+', ' ', g).strip()
            if not re.search(r'[가-힣]', g): continue
            gl.append(g[:MAX_LEN])
        if not gl: continue
        words.setdefault(key, []).append({'pos': POS.get(d.get('pos'), d.get('pos') or ''), 'ko': gl[:MAX_SENSES], '_lower': w == key})
# "BE" (an acronym) must not be mixed into "be": when a key has entries from the
# all-lowercase spelling, drop the ones that came from capitalised spellings.
for k, v in words.items():
    if any(e['_lower'] for e in v):
        words[k] = [e for e in v if e['_lower']]
for v in words.values():
    for e in v: del e['_lower']
os.makedirs(out, exist_ok=True)
with open(os.path.join(out, 'ko_dict.jsonl'), 'w', encoding='utf-8') as o:
    for k, v in sorted(words.items()):
        o.write(json.dumps({'word': k, 'ko': v}, ensure_ascii=False) + '\n')
def q(s): return "'" + s.replace("'", "''") + "'"
with open(os.path.join(out, 'ko_dict.sql'), 'w', encoding='utf-8') as o:
    o.write("CREATE TABLE IF NOT EXISTS ko_dict (word TEXT PRIMARY KEY, ko TEXT NOT NULL);\n")
    for k, v in sorted(words.items()):
        o.write(f"INSERT OR REPLACE INTO ko_dict (word, ko) VALUES ({q(k)}, {q(json.dumps(v, ensure_ascii=False))});\n")
irregular = {}
base = {'be':'am is are was were been being','have':'has had having','do':'does did done doing','go':'goes went gone going',
 'say':'said','make':'made','take':'took taken','come':'came','see':'saw seen','know':'knew known','get':'got gotten',
 'give':'gave given','find':'found','think':'thought','tell':'told','become':'became','leave':'left','feel':'felt',
 'bring':'brought','begin':'began begun','keep':'kept','hold':'held','write':'wrote written','stand':'stood',
 'hear':'heard','let':'let','mean':'meant','set':'set','meet':'met','run':'ran','pay':'paid','sit':'sat','speak':'spoke spoken',
 'lie':'lay lain','lead':'led','read':'read','grow':'grew grown','lose':'lost','fall':'fell fallen','send':'sent','build':'built',
 'understand':'understood','draw':'drew drawn','break':'broke broken','spend':'spent','cut':'cut','rise':'rose risen','drive':'drove driven',
 'buy':'bought','wear':'wore worn','choose':'chose chosen','sing':'sang sung','sleep':'slept','dream':'dreamt','burn':'burnt',
 'bear':'bore born borne','fly':'flew flown','forget':'forgot forgotten','sell':'sold','win':'won','catch':'caught','teach':'taught',
 'child':'children','man':'men','woman':'women','foot':'feet','tooth':'teeth','mouse':'mice','person':'people','life':'lives',
 'good':'better best','bad':'worse worst','well':'better best','many':'more most','little':'less least','far':'farther further',
 'I':'me my mine','he':'him his','she':'her hers','we':'us our ours','they':'them their theirs','this':'these','that':'those'}
for lemma, forms in base.items():
    for fm in forms.split(): irregular[fm.lower()] = lemma.lower()
with open(os.path.join(out, 'irregular.json'), 'w', encoding='utf-8') as o:
    json.dump(irregular, o, ensure_ascii=False, indent=0)
print('words', len(words), 'irregular', len(irregular))
