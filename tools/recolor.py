import colorsys
def recolor_pal(pal, groups, choice):
    """pal: list of 16 (r,g,b). groups: {slot:[indices]}; choice: {slot:(r,g,b)} -> new pal
    Keeps the original light ramp: each entry keeps its lightness offset vs the group's mean."""
    out=list(pal)
    for slot, idxs in groups.items():
        if slot not in choice: continue
        tr,tg,tb=[c/255 for c in choice[slot]]
        th,tl,ts=colorsys.rgb_to_hls(tr,tg,tb)
        Ls=[colorsys.rgb_to_hls(*[c/255 for c in pal[i]])[1] for i in idxs]
        mean=sum(Ls)/len(Ls)
        for i,L in zip(idxs,Ls):
            nl=min(0.97,max(0.06,tl+(L-mean)))
            r,g,b=colorsys.hls_to_rgb(th,nl,ts)
            out[i]=(round(r*255),round(g*255),round(b*255))
    return out
