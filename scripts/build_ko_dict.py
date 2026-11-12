"""en-from-ko.jsonl -> out/ko_dict.jsonl, out/ko_dict.sql, out/irregular.json
usage: python -I scripts/build_ko_dict.py scripts/en-from-ko.jsonl <out_dir>
       then copy <out_dir>/ko_dict.jsonl -> data/ko_dict.jsonl, <out_dir>/irregular.json -> data/ko_irregular.json
scripts/en-from-ko.jsonl: the English words ({word, pos, glosses}) of kaikki.org's Korean Wiktionary extract.
"""
import sys, json, os, re
src, out = sys.argv[1], sys.argv[2]
POS = {'noun':'명사','verb':'동사','adj':'형용사','adv':'부사','prep':'전치사','pron':'대명사',
       'conj':'접속사','intj':'감탄사','num':'수사','det':'한정사','phrase':'구','name':'고유명사'}
MAX_SENSES, MAX_LEN = 3, 90
HERE = os.path.dirname(os.path.abspath(__file__))

# Grammar notes that Wiktionary puts in front of or inside a meaning. They mean nothing to
# a reader ("(타동사)", "(불가산)", "(부록: 영어 수사)", "[주로 수동태로]"), so they are
# dropped. Notes about the field ("(법률)", "(식물)") or the register ("(격식)") stay.
GRAMMAR = re.compile(
    r'(?:타동사|자동사|비자동사|능격 동사|타|자|불가산|가산(?: 명사)?|목적어 없이|한정적 형용사|서술적|'
    r'진행형으로는 쓰이지 않음|단수 취급|VN|(?:pl|sing)\.|부록:.*|자동사 또는 타동사.*|'
    r'(?:주로|흔히|대개|보통|종종|언제나)?\s*(?:명사 앞에(?:서 그것을 수식하는|만|는 안)?\s*(?:씀)?|수동태로|'
    r'(?:단수|복수)(?:형)?(?:으로|로)?(?:서|만)?(?:\s*사용됨?)?))')
NOTE_GROUP = re.compile(r'\(([^()]*)\)|\[([^\[\]]*)\]')

def strip_notes(g):
    def fix(m):
        inner = m.group(1) if m.group(1) is not None else m.group(2)
        open_, close = ('(', ')') if m.group(1) is not None else ('[', ']')
        toks = [t.strip() for t in re.split(r'[,/;]', inner)]
        keep = [t for t in toks if t and not GRAMMAR.fullmatch(t)]
        if len(keep) == len([t for t in toks if t]):      # nothing to drop: leave it alone
            return m.group(0)
        return f"{open_}{', '.join(keep)}{close}" if keep else ''
    g = NOTE_GROUP.sub(fix, g)
    g = re.sub(r'\s+', ' ', g).strip()
    PH = r'(?:somebody|someone|something)'                  # English placeholders: "~ somebody/something 적시다"
    if re.search(PH, g):
        g = re.sub(r'~?\s*\b' + PH + r'(?:/' + PH + r')*\b', '', g)
        g = re.sub(r'(?:\s*\|\s*)+', ' ', g)
        g = re.sub(r'\s+', ' ', g).strip()
    g = re.sub(r'^«[^»]*[A-Za-z][^»]*»\s*', '', g)          # leading usage pattern: "«[V -ing] keep doing something »"
    g = re.sub(r'^~\s+', '', g)                            # "~ (…라고) 생각하다" -> "(…라고) 생각하다"
    return re.sub(r'\s+([,.;])', r'\1', g)

def clean_gloss(g):
    g = strip_notes(re.sub(r'\s+', ' ', g).strip())
    # drop (...) groups that have no Hangul, innermost first: "(With the source of or at.)"
    prev = None
    while prev != g:
        prev = g
        g = re.sub(r'\(([^()가-힣]*)\)', lambda m: '' if re.search(r'[A-Za-z]{2,}', m.group(1)) else m.group(0), g)
    # drop [..] / 〔..〕 groups that hold an English definition (long, no Hangul);
    # short ones like "[~ have + done]" are usage patterns and stay
    g = re.sub(r'[\[〔]([^\[\]〔〕가-힣]*)[\]〕]',
               lambda m: '' if len(re.findall(r'[A-Za-z]', m.group(1))) >= 15 else m.group(0), g)
    g = re.sub(r'\s+', ' ', g).strip()
    segs = [s.strip() for s in g.split(' / ')]
    out = []
    for s in segs:
        # trailing English sentence after Korean text:  "…있다. The first mentioned of two things."
        s = re.sub(r'(?<=[가-힣.\]\)])\s+[A-Za-z][A-Za-z ,;:\'"\-]*[A-Za-z.!?]*\s*$', '', s).strip()
        if re.search(r'[가-힣]', s):
            out.append(s)
    g = ' / '.join(out)
    # a gloss that is mostly Latin letters is a quotation or an English leftover
    if len(re.findall(r'[A-Za-z]', g)) > 3 * len(re.findall(r'[가-힣]', g)): return ''
    g = re.sub(r'\(\s*\)', '', g)
    g = re.sub(r'\s+([,.;])', r'\1', g)
    g = re.sub(r'^[\s…·,;/]+|[\s,;/]+$', '', g)
    return re.sub(r'\s+', ' ', g).strip()

def shorten(g):
    """Cut a long gloss at a ' / ' boundary instead of in the middle of a word."""
    if len(g) <= MAX_LEN: return g
    keep = []
    for seg in g.split(' / '):
        if keep and len(' / '.join(keep + [seg])) > MAX_LEN: break
        keep.append(seg)
    return ' / '.join(keep)[:MAX_LEN * 2]

words = {}
with open(src, encoding='utf-8') as f:
    for line in f:
        d = json.loads(line)
        w = d['word']
        if not re.fullmatch(r"[A-Za-z][A-Za-z'\- ]*", w): continue
        key = w.lower()
        gl = []
        for g in d['glosses']:
            g = clean_gloss(g)
            if not re.search(r'[가-힣]', g): continue
            gl.append(shorten(g))
        if not gl: continue
        words.setdefault(key, []).append({'pos': POS.get(d.get('pos'), d.get('pos') or ''), 'ko': gl[:MAX_SENSES], '_lower': w == key})
# "BE" (an acronym) must not be mixed into "be": when a key has entries from the
# all-lowercase spelling, drop the ones that came from capitalised spellings.
for k, v in words.items():
    if any(e['_lower'] for e in v):
        words[k] = [e for e in v if e['_lower']]
for v in words.values():
    for e in v: del e['_lower']
# Hand-written meanings for archaic / poetic words that Wiktionary's Korean
# edition does not cover (scripts/ko_archaic.json). A word that is missing from
# the dictionary gets this entry; a word that exists ("art", "wont") gets it appended.
with open(os.path.join(HERE, 'ko_archaic.json'), encoding='utf-8') as f:
    archaic = json.load(f)
for k, text in archaic.items():
    m = re.match(r'\((고어·시어|고어|시어)\) ', text)   # the label becomes the part-of-speech chip
    entry = {'pos': m.group(1) if m else '고어', 'ko': [text[m.end():] if m else text],
             'own': True,      # written by the team, not from Wiktionary
             'exact': True}    # belongs to this exact spelling only ("wast" is not "wasted")
    words.setdefault(k, [])
    words[k].append(entry)
# Hand-written meanings for words that appear in the app's poems (or are very
# common) but are missing from Wiktionary's Korean edition (scripts/ko_extra.json).
# Same rule as above: missing word -> new entry, existing word -> appended last.
# Unlike the archaic ones, these are normal base words, so "deeds" may find "deed".
with open(os.path.join(HERE, 'ko_extra.json'), encoding='utf-8') as f:
    extra = json.load(f)
for k, entries in extra.items():
    words.setdefault(k, [])
    for ent in entries:
        words[k].append({'pos': ent['pos'], 'ko': ent['ko'], 'own': True})
# Hand-written meanings that must come FIRST (scripts/ko_first.json). Wiktionary's
# Korean edition sometimes lacks the most common sense of a very common word
# ("old" only has the noun, "are" starts with the area unit "아르", "felt" with the
# fabric). The entries are put in front of the Wiktionary ones; "drop_wiki": true
# also removes the Wiktionary entries (a name or abbreviation that is never meant).
# Value is a list of {pos, ko} or {"entries": [...], "drop_wiki": true}.
with open(os.path.join(HERE, 'ko_first.json'), encoding='utf-8') as f:
    first = json.load(f)
for k, val in first.items():
    entries, drop = (val, False) if isinstance(val, list) else (val['entries'], val.get('drop_wiki', False))
    old = [] if drop else words.get(k, [])
    words[k] = [{'pos': ent['pos'], 'ko': ent['ko'], 'own': True} for ent in entries] + old
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
# More irregular verbs / plurals that show up in poems ("fled", "sunk", "torn", "leaves"...)
base.update({'flee':'fled','sink':'sank sunk','string':'strung','tear':'tore torn','swear':'swore sworn','bind':'bound',
 'spin':'spun','sting':'stung','swing':'swung','hang':'hung','dig':'dug','strike':'struck stricken','steal':'stole stolen',
 'freeze':'froze frozen','shake':'shook shaken','wake':'woke woken','seek':'sought','fight':'fought','bend':'bent',
 'lend':'lent','light':'lit','slide':'slid','shoot':'shot','hide':'hid hidden','ride':'rode ridden','strive':'strove striven',
 'tread':'trod trodden','sweep':'swept','weep':'wept','creep':'crept','leap':'leapt','deal':'dealt','feed':'fed',
 'bleed':'bled','breed':'bred','speed':'sped','swim':'swam swum','ring':'rang rung','drink':'drank drunk','shrink':'shrank shrunk',
 'spring':'sprang sprung','throw':'threw thrown','blow':'blew blown','show':'shown','lay':'laid','eat':'ate eaten',
 'forgive':'forgave forgiven','forsake':'forsook forsaken','arise':'arose arisen','awake':'awoke awoken','beat':'beaten',
 'bite':'bit bitten','cling':'clung','fling':'flung','slay':'slew slain','smite':'smote smitten','swell':'swollen',
 'wring':'wrung','stride':'strode stridden','rend':'rent','bid':'bade','behold':'beheld','work':'wrought',
 'leaf':'leaves','wife':'wives','knife':'knives','wolf':'wolves','self':'selves','half':'halves','shelf':'shelves',
 'thief':'thieves','loaf':'loaves','calf':'calves','hero':'heroes','ox':'oxen','goose':'geese','louse':'lice',
 'die':'dying','tie':'tying','shine':'shone','smell':'smelt','dwell':'dwelt','spell':'spelt','spill':'spilt',
 'learn':'learnt','weave':'wove woven','sew':'sewn','mow':'mown','prove':'proven'})
base['lie'] += ' lying'
for lemma, forms in base.items():
    for fm in forms.split(): irregular[fm.lower()] = lemma.lower()
with open(os.path.join(out, 'irregular.json'), 'w', encoding='utf-8') as o:
    json.dump(irregular, o, ensure_ascii=False, indent=0)
print('words', len(words), 'irregular', len(irregular))
