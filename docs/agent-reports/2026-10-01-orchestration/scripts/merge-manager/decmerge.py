# resolve docs/DECISIONS.md conflicts in a merge (ours=PR, theirs=main): main first, then PR
s=open('docs/DECISIONS.md').read().split('\n'); out=[]; i=0
while i<len(s):
    if s[i].startswith('<<<<<<< '):
        a=[];b=[];i+=1
        while not s[i].startswith('======='): a.append(s[i]); i+=1
        i+=1
        while not s[i].startswith('>>>>>>> '): b.append(s[i]); i+=1
        i+=1
        while b and b[-1]=='': b.pop()
        while a and a[0]=='': a.pop(0)
        out+= b + ([''] if a and b else []) + a
    else: out.append(s[i]); i+=1
open('docs/DECISIONS.md','w').write('\n'.join(out))
