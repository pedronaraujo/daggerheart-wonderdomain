#!/usr/bin/env python3
"""
Generates the compendium source JSON for the Wonder Domain module.

Run:  python3 tools/build_data.py
Then: npm run pack     (compiles src/packs/* into LevelDB packs/*)

Data model targets the Foundryborne Daggerheart system 2.12.x on Foundry v14.
"""
import hashlib
import json
import os
import shutil
import string
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MOD = "daggerheart-wonderdomain"
SRC = os.path.join(ROOT, "src", "packs")
ATTR = {"source": "Wonder Domain (Reno Reizakki) — DPCGL", "page": None, "artist": "", "srd": False}
ART = "wonder-domain-art"  # folder in the Foundry user data (see tools/build_art.py)


def art(name):
    return f"{ART}/{name}.webp"


DOMAIN_ICON = f"modules/{MOD}/assets/wonder.svg"

VALID_ICONS = set()
_icons_file = os.path.join(ROOT, "tools", "valid_icons.txt")
if os.path.exists(_icons_file):
    VALID_ICONS = set(open(_icons_file).read().split())


def ic(path):
    """Guard against typos in core icon paths."""
    if path.startswith(("modules/", "systems/", "wonder-domain-art/")) or not VALID_ICONS:
        return path
    if path not in VALID_ICONS:
        print(f"  ! unknown icon {path}", file=sys.stderr)
        return "icons/magic/symbols/star-yellow.webp"
    return path


ALNUM = string.ascii_letters + string.digits


def rid(key):
    """Deterministic 16-char Foundry id from a key."""
    h = hashlib.sha256(f"{MOD}:{key}".encode()).digest()
    return "".join(ALNUM[b % len(ALNUM)] for b in h[:16])


def uuid(pack, _id, doc="Item"):
    return f"Compendium.{MOD}.{pack}.{doc}.{_id}"


# ---------------------------------------------------------------------------
# Action helpers (mirror system/module/data/action field schemas)
# ---------------------------------------------------------------------------

def cost(key, value=1, scalable=False, step=None, item_id=None, on_success=False):
    return {"scalable": scalable, "key": key, "value": value, "step": step,
            "itemId": item_id, "consumeOnSuccess": on_success}


def uses(max_=None, recovery=None):
    return {"value": None, "max": "" if max_ is None else str(max_), "recovery": recovery,
            "consumeOnSuccess": False}


def dmg_value(dice="d6", mult="prof", flat=1, bonus=None, formula=None):
    return {"custom": {"enabled": formula is not None, "formula": formula or ""},
            "multiplier": mult, "flatMultiplier": flat, "dice": dice, "bonus": bonus}


def main_damage(value, types=("magical",), apply_to="hitPoints"):
    return {"resultBased": False, "value": value, "applyTo": apply_to, "type": list(types),
            "base": False, "valueAlt": None, "includeBase": False, "direct": False,
            "fullRestore": False, "itemId": None}


def res_heal(apply_to, formula, item_id=None):
    return {"value": dmg_value(formula=formula, mult="flat"), "applyTo": apply_to, "base": False,
            "resultBased": False, "valueAlt": None, "fullRestore": False, "itemId": item_id}


def roll(rtype=None, trait=None, difficulty=None, dice="d6", mult="prof", flat=1, bonus=None):
    return {"type": rtype, "trait": trait, "difficulty": difficulty, "bonus": bonus, "advState": "neutral",
            "diceRolling": {"multiplier": mult, "flatMultiplier": flat, "dice": dice,
                            "compare": None, "treshold": None},
            "useDefault": False}


def action(key, name, atype, *, desc="", img=None, costs=None, use=None, rng="", target=None,
           roll_=None, damage=None, resources=None, effects=None, save=None, action_type="action",
           _id=None, chat=True):
    a = {
        "type": atype,
        "_id": _id or rid("action:" + key),
        "systemPath": "actions",
        "description": desc,
        "chatDisplay": chat,
        "actionType": action_type,
        "cost": costs or [],
        "uses": use or uses(),
        "name": name,
        "img": ic(img or "icons/magic/symbols/star-yellow.webp"),
        "range": rng,
        "baseAction": False,
        "originItem": {"type": "itemCollection"},
        "triggers": [],
        "areas": [],
    }
    if atype in ("attack", "damage", "healing", "effect"):
        a["target"] = target or {"type": "any", "amount": None}
    if atype in ("attack", "damage", "healing"):
        a["damage"] = {"main": damage, "resources": resources or {}}
    if atype in ("attack", "damage", "effect", "healing"):
        a["effects"] = [{"_id": e, "onSave": False} for e in (effects or [])]
    if atype in ("attack", "healing"):
        a["roll"] = roll_ or roll()
    if atype == "attack":
        a["save"] = save or {"trait": None, "difficulty": None, "damageMod": "none"}
    return a


def effect(key, item_id, name, *, img, desc="", changes=None, statuses=None, transfer=False,
           duration="temporary", disabled=False):
    _id = rid(key)
    return {
        "_id": _id,
        "name": name,
        "img": ic(img),
        "description": desc,
        "type": "base",
        "disabled": disabled,
        "transfer": transfer,
        "statuses": statuses or [],
        "system": {"changes": changes or [], "duration": {"description": "", "type": duration},
                   "rangeDependence": None, "stacking": None, "targetDispositions": [], "conditionals": []},
        "start": None,
        "duration": {"value": None, "units": "seconds", "expiry": None, "expired": False},
        "tint": "#ffffff",
        "showIcon": 1,
        "folder": None,
        "sort": 0,
        "flags": {},
        "_stats": {"compendiumSource": None},
        "_key": f"!items.effects!{item_id}.{_id}",
    }


def chg(key, value, type_="add"):
    return {"key": key, "type": type_, "value": value, "priority": None, "phase": "initial"}


def resource(value=0, max_=None, icon="fa-solid fa-star", rtype="simple", faces="d4", recovery=None,
             progression="increasing"):
    return {"type": rtype, "value": value, "max": max_, "icon": icon, "recovery": recovery,
            "progression": progression, "diceStates": {}, "dieFaces": faces}


def p(*paras):
    return "".join(f"<p>{x}</p>" for x in paras)


# ---------------------------------------------------------------------------
# Special action ids routed to module UIs (keep in sync with scripts/constants.mjs)
# ---------------------------------------------------------------------------
SPECIAL = {
    "starChart": "wndStarChartOpen",
    "constellation": "wndConstellation",
    "empyrean": "wndEmpyreanCall0",
    "workshop": "wndWorkshopOpen0",
    "surge": "wndIngeniousSrg0",
    "tinkering": "wndTinkeringBnch",
    "glimpse": "wndGlimpseDice00",
    "moonReduce": "wndMoonShieldRed",
    "masterpiece": "wndMasterpieceWk",
    "appraisal": "wndAppraisal0000",
    "dreamSignal": "wndDreamSignal00",
    "twinnedMinds": "wndTwinnedMinds0",
    "cosmicInspire": "wndCosmicInspir0",
    "archive": "wndArchiveOpen00",
    "moonEnd": "wndMoonShieldEnd",
    "useDevice": "wndUseDevice0000",
    "breakthrough": "wndBreakthrough0",
    "sharedDreams": "wndSharedDreams0",
    "gemology": "wndGemology00000",
}

# ---------------------------------------------------------------------------
# Document builders
# ---------------------------------------------------------------------------

def base_item(key, name, itype, img, system, folder=None, effects=None, flags=None):
    _id = rid("item:" + key)
    return {
        "_id": _id, "name": name, "type": itype, "img": ic(img), "folder": folder,
        "system": system, "effects": effects or [], "sort": 0,
        "flags": flags or {}, "_key": f"!items!{_id}",
    }


def feature(key, name, img, desc, *, actions=None, res=None, form="passive", folder=None, effects=None,
            flags=None):
    sysd = {"description": desc, "resource": res, "actions": {}, "attribution": ATTR, "gmNotes": "",
            "granter": None, "featureForm": form, "actorResources": []}
    it = base_item(key, name, "feature", img, sysd, folder=folder, flags=flags)
    for a in actions or []:
        sysd["actions"][a["_id"]] = a
    if effects:
        it["effects"] = [dict(e, _key=f"!items.effects!{it['_id']}.{e['_id']}") for e in effects]
    return it


def folder(key, name, color=None, parent=None, sort=0):
    _id = rid("folder:" + key)
    return {"type": "Item", "folder": parent, "name": name, "color": color, "sorting": "a", "_id": _id,
            "description": "", "sort": sort, "flags": {}, "_key": f"!folders!{_id}"}


# ===========================================================================
# WONDER DOMAIN CARDS
# ===========================================================================

def domain_cards():
    cards = []

    def card(key, name, level, ctype, recall, desc, actions=(), res=None, effects=(), flags=None):
        _id = rid("item:card:" + key)
        sysd = {"description": desc, "domain": "wonder", "recallCost": recall, "level": level, "type": ctype,
                "actions": {a["_id"]: a for a in actions}, "attribution": ATTR, "gmNotes": "",
                "resource": res, "inVault": False, "vaultActive": False, "loadoutIgnore": False,
                "domainTouched": None}
        it = {"_id": _id, "name": name, "type": "domainCard", "img": art("card-" + key), "folder": None,
              "system": sysd, "sort": level * 100000 + len(cards), "flags": flags or {},
              "_key": f"!items!{_id}",
              "effects": [dict(e, _key=f"!items.effects!{_id}.{e['_id']}") for e in effects]}
        cards.append(it)
        return _id

    # ---- Level 1 -----------------------------------------------------------
    cid = rid("item:card:craftsmanship")
    card("craftsmanship", "Craftsmanship", 1, "ability", 0,
         p("You can craft a device as downtime move during a rest. The device is a non-magical object no larger "
           "than your hand. Describe what it is and what is its intended purpose. The device by itself cannot "
           "initiate an action, like create a fire or attack as a weapon, and it disappears if you craft a new one.",
           "When anyone carrying the device performs an action related to its designed purpose, they may gain a "
           "<strong>+2</strong> bonus to the roll and the device is depleted. You may <strong>spend a Hope</strong> "
           "while touching the device to recharge it."),
         res=resource(0, "1", "fa-solid fa-gears"),
         actions=[
             action("craftsmanship.craft", "Craft Device", "healing", img="icons/commodities/tech/cog-brass.webp",
                    desc=p("Downtime move: craft (or replace) your device. It starts charged."),
                    target={"type": "self", "amount": None}, roll_=roll(None),
                    resources={"resource": res_heal("resource", "1", cid)}),
             action("craftsmanship.use", "Use Device (+2)", "effect", _id=SPECIAL["useDevice"],
                    img="icons/commodities/tech/cog-brass.webp",
                    desc=p("The carrier gains +2 on their next roll related to the device's purpose. The device is depleted."),
                    costs=[cost("resource", 1, item_id=cid)], target={"type": "any", "amount": 1}),
             action("craftsmanship.recharge", "Recharge Device", "healing", img="icons/commodities/tech/cog-brass.webp",
                    desc=p("Spend a Hope while touching the device to recharge it."),
                    costs=[cost("hope", 1)], target={"type": "self", "amount": None},
                    roll_=roll(None), resources={"resource": res_heal("resource", "1", cid)}),
         ])

    rid_inscribed = "effect:runicshot.inscribed"
    card("runicShot", "Runic Shot", 1, "spell", 1,
         p("Make a <strong>Spellcast Roll</strong> against a target within Far range. On a success, deal "
           "<strong>d6</strong> magic damage using your Proficiency and you may <strong>spend a Hope</strong> to make "
           "the target temporarily <em>Inscribed</em>. While <em>Inscribed</em>, the target cannot benefit from advantage.",
           "If you use this spell as part of a Tag Team Roll, you instead deal <strong>d10</strong> magic damage using "
           "your Proficiency."),
         actions=[
             action("runicShot.cast", "Cast", "attack", img="icons/magic/symbols/runes-star-blue.webp", rng="far",
                    roll_=roll("spellcast"), damage=main_damage(dmg_value("d6")),
                    target={"type": "any", "amount": 1}),
             action("runicShot.inscribe", "Inscribe (spend Hope)", "effect", img="icons/magic/symbols/runes-triangle-blue.webp",
                    costs=[cost("hope", 1)], target={"type": "any", "amount": 1}, rng="far",
                    effects=[rid(rid_inscribed)]),
             action("runicShot.tagteam", "Tag Team Damage", "damage", img="icons/magic/symbols/runes-star-magenta.webp",
                    desc=p("Damage when used as part of a Tag Team Roll."), rng="far",
                    damage=main_damage(dmg_value("d10")), target={"type": "any", "amount": 1}),
         ],
         effects=[effect(rid_inscribed, "", "Inscribed", img="icons/magic/symbols/runes-triangle-blue.webp",
                         desc=p("While <em>Inscribed</em>, the target cannot benefit from advantage."))])

    card("sharedDreams", "Shared Dreams", 1, "ability", 0,
         p("You and any number of allies may share a dream during a long rest as a downtime move. Work together to "
           "describe what happens in the dream. All creatures that shared the dream <strong>gain a Hope</strong>.",
           "Until your next long rest, when someone Helps an Ally they shared a dream with, the one helping may roll "
           "two advantage dice and take the highest result."),
         actions=[
             action("sharedDreams.dream", "Share a Dream", "healing", _id=SPECIAL["sharedDreams"], img="icons/magic/control/sleep-bubble-purple.webp",
                    desc=p("Downtime move: everyone who shared the dream gains a Hope."),
                    target={"type": "friendly", "amount": None}, roll_=roll(None),
                    resources={"hope": res_heal("hope", "1")}),
         ])

    # ---- Level 2 -----------------------------------------------------------
    rb_restr = "effect:runebound.restrained"
    card("runebound", "Runebound", 2, "spell", 1,
         p("<strong>Spend a Hope</strong> to touch a surface or object and create a flickering magical ripple no larger "
           "than your Melee range. When a creature interacts with or moves through the ripple, they must make a "
           "<strong>Reaction Roll (13)</strong>. On a failure, they suffer <strong>d6+6</strong> magic damage using your "
           "Proficiency and are temporarily <em>Restrained</em>. The ripple lasts until triggered or until your next rest."),
         actions=[
             action("runebound.create", "Create Ripple", "effect", img="icons/magic/symbols/runes-carved-stone-yellow.webp",
                    costs=[cost("hope", 1)], rng="melee", target={"type": "self", "amount": None}),
             action("runebound.trigger", "Ripple Triggered", "attack", img="icons/magic/symbols/runes-star-orange-purple.webp",
                    desc=p("The triggering creature makes a Reaction Roll (13). On a failure: d6+6 magic damage and Restrained."),
                    roll_=roll(None), damage=main_damage(dmg_value("d6", bonus=6)),
                    save={"trait": None, "difficulty": 13, "damageMod": "none"},
                    effects=[rid(rb_restr)], target={"type": "any", "amount": 1}),
         ],
         effects=[effect(rb_restr, "", "Restrained (Runebound)", img="icons/magic/control/debuff-chains-blue.webp",
                         statuses=["restrained"])])

    card("windsOfChange", "Winds of Change", 2, "ability", 0,
         p("When an ally within Close range rolls a Failure with Fear, describe how you bolster their confidence. You may "
           "<strong>spend a Hope</strong> to allow them to <strong>gain a Hope</strong>."),
         actions=[
             action("winds.bolster", "Bolster", "healing", img="icons/magic/air/wind-vortex-swirl-purple.webp",
                    action_type="reaction", costs=[cost("hope", 1)], rng="close",
                    target={"type": "friendly", "amount": 1}, roll_=roll(None),
                    resources={"hope": res_heal("hope", "1")}),
         ])

    # ---- Level 3 -----------------------------------------------------------
    card("divergingLens", "Diverging Lens", 3, "spell", 2,
         p("<strong>Mark a Stress</strong> to conjure a magical object within Far range. It remains in place until the "
           "end of the scene or you take Severe damage. When an ally within Close range of the object is hit by a "
           "creature in their Melee range, the attacker must make a <strong>Reaction Roll (14)</strong>. On a failure, "
           "they take <strong>2d4+4</strong> magic damage and are pushed just outside Close range of the ally they "
           "attacked. A creature may only be targeted by one object per attack, prioritizing the closest one."),
         actions=[
             action("lens.conjure", "Conjure Lens", "effect", img="icons/commodities/materials/glass-orb-blue-gold.webp",
                    costs=[cost("stress", 1)], rng="far", target={"type": "self", "amount": None}),
             action("lens.react", "Lens Retaliation", "attack", img="icons/magic/light/beam-impact-deflect-teal.webp",
                    action_type="reaction", roll_=roll(None),
                    damage=main_damage(dmg_value("d4", mult="flat", flat=2, bonus=4)),
                    save={"trait": None, "difficulty": 14, "damageMod": "none"},
                    target={"type": "hostile", "amount": 1}),
         ])

    mp_id = rid("item:card:masterpiece")
    card("masterpiece", "Masterpiece", 3, "ability", 0,
         p("When you <em>Work on a Project</em>, you may choose to work on a Masterpiece. Your Masterpiece has an initial "
           "value of <strong>0</strong> and when you take this downtime move, roll a <strong>d10</strong>. Add the result "
           "to its total value as handfuls of gold, then <strong>gain a Hope</strong>. When the Masterpiece's value reaches "
           "that of a chest, it is finished. You then choose a trait to gain a <strong>+1</strong> bonus and must place "
           "this card in your vault permanently. You may also sell your Masterpiece for its current value, at which point "
           "you lose its trait bonus and can start to create a new one.",
           "<em>The token counter on this card tracks the Masterpiece's value in handfuls (a chest = 100 handfuls).</em>"),
         res=resource(0, "100", "fa-solid fa-gem"),
         actions=[
             action("masterpiece.work", "Work on the Masterpiece", "effect", _id=SPECIAL["masterpiece"],
                    img="icons/commodities/treasure/crown-gold-satin-gems-red.webp",
                    desc=p("Roll a d10, add it to the Masterpiece's value and gain a Hope."),
                    target={"type": "self", "amount": None}),
         ])

    # ---- Level 4 -----------------------------------------------------------
    card("dreamSignal", "Dream Signal", 4, "spell", 0,
         p("Once per rest, <strong>spend a Hope</strong> to send a mind image to an ally within Far range when they "
           "attempt to make an action roll, giving them a bonus equal to your Spellcast trait. If they roll with Hope, "
           "they gain clarity on their actions and may also clear a Stress. If they roll with Fear, they receive a "
           "disturbing vision instead, and the GM gains 1 additional Fear."),
         actions=[
             action("dreamSignal.send", "Send Mind Image", "effect", _id=SPECIAL["dreamSignal"],
                    img="icons/magic/perception/third-eye-blue-red.webp",
                    desc=p("The ally adds your Spellcast trait to their next action roll. With Hope they clear a Stress; with Fear the GM gains a Fear."),
                    action_type="reaction", costs=[cost("hope", 1)], use=uses(1, "shortRest"), rng="far",
                    target={"type": "friendly", "amount": 1}),
         ])

    card("fidgetyBolt", "Fidgety Bolt", 4, "spell", 1,
         p("Make a <strong>Spellcast Roll</strong> against a target within Far range. On a success, "
           "<strong>mark a Stress</strong> to send a magic bolt that deals <strong>d8+8</strong> magic damage using your "
           "Proficiency.",
           "If your Hope die rolls <strong>8 or more</strong>, the bolt leaps to a second creature of your choice within "
           "Close range of the first. If your Fear die rolls <strong>8 or more</strong>, the GM chooses yet another new "
           "creature within Close range of the first to also be affected by the spell. In both cases, each additional "
           "target takes half the original damage."),
         actions=[
             action("fidgety.cast", "Cast", "attack", img="icons/magic/lightning/bolt-strike-sparks-teal.webp", rng="far",
                    costs=[cost("stress", 1, on_success=True)], roll_=roll("spellcast"),
                    damage=main_damage(dmg_value("d8", bonus=8)), target={"type": "any", "amount": 1}),
             action("fidgety.leap", "Leaping Bolt (half)", "damage", img="icons/magic/lightning/bolt-forked-teal.webp",
                    desc=p("Each additional target takes half the original damage — apply as half damage."),
                    damage=main_damage(dmg_value("d8", bonus=8)), target={"type": "any", "amount": 1}),
         ],
         flags={MOD: {"fidgety": True}})

    # ---- Level 5 -----------------------------------------------------------
    card("aerialStrike", "Aerial Strike", 5, "spell", 1,
         p("You conjure a magical pattern within Far range that floats above the ground. It lasts until the end of the "
           "scene or you conjure another pattern. While it is active, you may <strong>mark a Stress</strong> to move it "
           "within its Close range and make a <strong>Spellcast Roll</strong>. Each adversary within Very Close range of "
           "the pattern you succeed against takes <strong>1d10+10</strong> magic damage."),
         actions=[
             action("aerial.conjure", "Conjure Pattern", "effect", img="icons/magic/symbols/runes-star-pentagon-blue.webp",
                    rng="far", target={"type": "self", "amount": None}),
             action("aerial.strike", "Strike", "attack", img="icons/magic/light/beam-rays-teal-large.webp",
                    costs=[cost("stress", 1)], roll_=roll("spellcast"),
                    damage=main_damage(dmg_value("d10", mult="flat", flat=1, bonus=10)),
                    target={"type": "hostile", "amount": None}),
         ])

    gem_eff = "effect:gemology.extra"
    card("gemology", "Gemology", 5, "spell", 0,
         p("<strong>Spend 2 Hope</strong> during a rest to allow you or an ally sharing the rest to take an additional "
           "downtime move."),
         actions=[
             action("gemology.use", "Facet the Rest", "effect", _id=SPECIAL["gemology"],
                    img="icons/commodities/gems/gem-faceted-cushion-teal-black.webp",
                    costs=[cost("hope", 2)], target={"type": "friendly", "amount": 1}, effects=[rid(gem_eff)]),
         ],
         effects=[effect(gem_eff, "", "Gemology (+1 downtime move)", img="icons/commodities/gems/gem-faceted-cushion-teal-black.webp",
                         duration="longRest", desc=p("Take one additional downtime move during this rest."),
                         changes=[chg("system.bonuses.rest.shortRest.shortMoves", 1),
                                  chg("system.bonuses.rest.longRest.longMoves", 1)])])

    # ---- Level 6 -----------------------------------------------------------
    ms_id = rid("item:card:moonShield")
    ms_field = "effect:moonshield.field"
    card("moonShield", "Moon Shield", 6, "spell", 2,
         p("<strong>Mark a Stress</strong> to create a field within Very Close range that lasts until the end of the "
           "scene or you take Severe damage. The field moves with you and, while active, you add your Spellcast trait "
           "to your damage thresholds.",
           "When you create the field, place 2 tokens on this card. These are your <em>Lunar tokens</em>. You may also "
           "<strong>spend a Hope</strong> to place 2 Lunar tokens on this card. When an ally takes damage while within "
           "the field, spend any amount of Lunar tokens to reduce the damage taken by <strong>1d6</strong> per token "
           "spent. When the spell ends, clear all tokens on this card."),
         res=resource(0, None, "fa-solid fa-moon"),
         actions=[
             action("moon.create", "Create Field", "healing", img="icons/magic/defensive/barrier-shield-dome-blue-purple.webp",
                    costs=[cost("stress", 1)], rng="veryClose", target={"type": "self", "amount": None},
                    roll_=roll(None), resources={"resource": res_heal("resource", "2", ms_id)},
                    effects=[rid(ms_field)]),
             action("moon.tokens", "Add 2 Lunar Tokens", "healing", img="icons/commodities/currency/coin-engraved-moon-silver.webp",
                    costs=[cost("hope", 1)], target={"type": "self", "amount": None}, roll_=roll(None),
                    resources={"resource": res_heal("resource", "2", ms_id)}),
             action("moon.reduce", "Spend Lunar Tokens", "effect", _id=SPECIAL["moonReduce"],
                    img="icons/creatures/birds/raptor-owl-flying-moon.webp", action_type="reaction",
                    desc=p("Choose how many Lunar tokens to spend; roll 1d6 per token to reduce the damage an ally takes."),
                    target={"type": "friendly", "amount": 1}),
             action("moon.end", "End Field", "effect", _id=SPECIAL["moonEnd"],
                    img="icons/magic/defensive/barrier-shield-dome-pink.webp",
                    desc=p("The field ends (end of scene or Severe damage): clear all Lunar tokens."),
                    target={"type": "self", "amount": None}),
         ],
         effects=[effect(ms_field, "", "Moon Shield Field", img="icons/magic/defensive/barrier-shield-dome-blue-purple.webp",
                         desc=p("You add your Spellcast trait to your damage thresholds."), duration="scene",
                         changes=[chg("system.damageThresholds.major", "@cast"),
                                  chg("system.damageThresholds.severe", "@cast")])])

    card("twinnedMinds", "Twinned Minds", 6, "spell", 2,
         p("Once per rest, you and an ally in Far range may both <strong>mark a Stress</strong> to synchronize your "
           "thoughts. Until the end of the scene or one of you mark their last Hit Point, you two gain the following "
           "benefits:")
         + "<ul><li>You and the ally gain access to level 3 or lower domain cards from either loadout. If a card requires "
           "a Spellcast Roll, it uses your Spellcast trait.</li><li>It costs 2 Hope to initiate a Tag Team Roll with each "
           "other.</li><li>Once for the duration of the spell, when one rolls a critical success, you may both gain a Hope "
           "and clear a Stress.</li></ul>",
         actions=[
             action("twinned.sync", "Synchronize", "effect", _id=SPECIAL["twinnedMinds"],
                    img="icons/magic/perception/orb-eye-scrying.webp",
                    desc=p("You and the targeted ally each mark a Stress and gain Twinned Minds until the end of the scene."),
                    costs=[cost("stress", 1)], use=uses(1, "shortRest"), rng="far",
                    target={"type": "friendly", "amount": 1}),
             action("twinned.crit", "Shared Triumph", "healing", img="icons/magic/light/explosion-star-small-teal.webp",
                    desc=p("Once per spell: on a critical success, you both gain a Hope and clear a Stress."),
                    target={"type": "friendly", "amount": 2}, roll_=roll(None),
                    resources={"hope": res_heal("hope", "1"), "stress": res_heal("stress", "1")}),
         ])

    # ---- Level 7 -----------------------------------------------------------
    dazzled = "effect:aurora.dazzled"
    card("auroraBlast", "Aurora Blast", 7, "spell", 1,
         p("Make a <strong>Spellcast Roll</strong> against a target in Far range. On a success, spend up to "
           "<strong>3 Hope</strong>. The effects are cumulative per Hope you spend.")
         + "<ul><li><strong>1 Hope:</strong> The target takes <strong>d6+6</strong> magic damage using your Proficiency.</li>"
           "<li><strong>2 Hope:</strong> The target is temporarily <em>Dazzled</em>. While <em>Dazzled</em>, they are "
           "<em>Vulnerable</em> and all their rolls have disadvantage.</li>"
           "<li><strong>3 Hope:</strong> The spell refracts to two other targets of your choice within Close range of the "
           "first target that can also be hit, dealing half the damage and making them temporarily <em>Dazzled</em>.</li></ul>",
         actions=[
             action("aurora.cast", "Cast (1 Hope)", "attack", img="icons/magic/light/beams-rays-orange-purple-large.webp",
                    rng="far", costs=[cost("hope", 1, on_success=True)], roll_=roll("spellcast"),
                    damage=main_damage(dmg_value("d6", bonus=6)), target={"type": "any", "amount": 1}),
             action("aurora.dazzle", "Dazzle (+1 Hope)", "effect", img="icons/magic/light/explosion-star-glow-blue-purple.webp",
                    costs=[cost("hope", 1)], rng="far", target={"type": "any", "amount": 1}, effects=[rid(dazzled)]),
             action("aurora.refract", "Refract (+1 Hope)", "damage", img="icons/magic/light/projectiles-star-purple.webp",
                    desc=p("Two more targets take half damage and become Dazzled."), costs=[cost("hope", 1)],
                    damage=main_damage(dmg_value("d6", bonus=6)), target={"type": "any", "amount": 2},
                    effects=[rid(dazzled)]),
         ],
         effects=[effect(dazzled, "", "Dazzled", img="icons/magic/light/explosion-star-glow-blue-purple.webp",
                         desc=p("While <em>Dazzled</em>, the target is <em>Vulnerable</em> and all their rolls have disadvantage."),
                         statuses=["vulnerable"],
                         changes=[chg("system.disadvantageSources", "Dazzled (all rolls)")])])

    card("wonderTouched", "Wonder-Touched", 7, "ability", 1,
         p("When 4 or more of the domain cards in your loadout are from the Wonder domain, gain the following benefits:")
         + "<ul><li>You can mark a Stress instead of spending a Hope.</li><li>Once per long rest, when you would mark your "
           "last Stress, clear Stress equal to your Spellcast trait instead. You must still mark any remaining Stress.</li></ul>",
         actions=[
             action("wonderTouched.recover", "Wondrous Recovery", "healing", img="icons/magic/light/hand-sparks-smoke-teal.webp",
                    action_type="reaction", use=uses(1, "longRest"), target={"type": "self", "amount": None},
                    roll_=roll(None), resources={"stress": res_heal("stress", "@cast")}),
         ],
         flags={MOD: {"wonderTouched": True}})

    # ---- Level 8 -----------------------------------------------------------
    card("archiveOfPossibilities", "Archive of Possibilities", 8, "spell", 0,
         p("Place this card in your vault to open a shimmering rift to an imagined archive of ideas. You and all allies "
           "within Far range may recall a card from their vault without paying its Recall Cost.",
           "This card can only be recalled into your loadout during a rest."),
         actions=[
             action("archive.open", "Open the Archive", "effect", _id=SPECIAL["archive"],
                    img="icons/sundries/books/book-open-brown.webp",
                    rng="far", target={"type": "friendly", "amount": None}),
         ])

    card("breakthrough", "Breakthrough", 8, "spell", 2,
         p("Make a <strong>Spellcast Roll (16)</strong>. On a success, you inspire a breakthrough discovery for you and "
           "every ally within Far range.",
           "Every target may select a card of level 4 or lower from a domain they have access to and mark Stress equal "
           "to the card's Recall Cost. The chosen card is then placed in their loadout until the end of the scene or "
           "this spell is cast again. The selected card do not count towards the maximum number of cards in their "
           "loadout and cannot be exchanged for a card in their vault.",
           "After you successfully use this spell, place this card in your vault."),
         actions=[
             action("breakthrough.cast", "Cast", "attack", _id=SPECIAL["breakthrough"],
                    img="icons/magic/light/explosion-star-glow-yellow.webp",
                    rng="far", roll_=roll("spellcast", difficulty=16), target={"type": "friendly", "amount": None}),
         ])

    # ---- Level 9 -----------------------------------------------------------
    card("cosmicInspiration", "Cosmic Inspiration", 9, "ability", 1,
         p("When an ally within Far range fails an action roll or rolls with Fear, you may <strong>spend a Hope</strong> "
           "to allow the target to reroll using a <strong>d20</strong> as their Hope Die."),
         actions=[
             action("cosmic.inspire", "Inspire", "effect", _id=SPECIAL["cosmicInspire"],
                    img="icons/magic/symbols/star-rising-purple.webp",
                    desc=p("The ally rerolls with a d20 as their Hope Die (applied to their next duality roll)."),
                    action_type="reaction", costs=[cost("hope", 1)], rng="far", target={"type": "friendly", "amount": 1}),
         ])

    card("ruleOfSix", "Rule of Six", 9, "spell", 2,
         p("Make a <strong>Spellcast Roll</strong> against up to six targets within Close range. On a success, "
           "<strong>mark any number of Stress</strong> to deal <strong>6d6</strong> magic damage for each Stress marked, "
           "divided equally among all targets. For each 6 rolled on a damage die for this spell, roll an additional d6."),
         actions=[
             action("ruleOfSix.cast", "Cast", "attack", img="icons/magic/symbols/squares-3d-green.webp", rng="close",
                    costs=[cost("stress", 1, scalable=True, step=1, on_success=True)], roll_=roll("spellcast"),
                    damage=main_damage(dmg_value(formula="(@scale*6)d6x6")), target={"type": "any", "amount": 6}),
         ])

    # ---- Level 10 ----------------------------------------------------------
    card("imaginarium", "Imaginarium", 10, "spell", 2,
         p("Make a <strong>Spellcast Roll (18)</strong>. On a success, you create an Imaginarium that extends within Very "
           "Far range and lasts until the end of the scene or this spell is cast again. Choose two domains. Pick up to 5 "
           "cards of level 5 or lower from those domains and <strong>mark a Stress</strong> for each card chosen. They "
           "become the Imaginarium's loadout.",
           "While in the area, all allies may use a card from the Imaginarium's loadout as if it was in their own loadout, "
           "spending any other resources that are normally required when using the card. If a card requires a Spellcast "
           "Roll, it uses your Spellcast trait.",
           "The GM may spend a Fear to force you to remove a card of your choice from the loadout. If this GM move removes "
           "the last card from the loadout, the spell ends."),
         actions=[
             action("imaginarium.cast", "Cast", "attack", img="icons/magic/light/explosion-glow-spiral-teal.webp",
                    rng="veryFar", roll_=roll("spellcast", difficulty=18), target={"type": "self", "amount": None}),
             action("imaginarium.cards", "Choose Cards (Stress each)", "effect", img="icons/magic/symbols/circled-gem-pink.webp",
                    costs=[cost("stress", 1, scalable=True, step=1)], target={"type": "self", "amount": None}),
         ])

    paradox_eff = "effect:paradox.state"
    card("paradoxFlux", "Paradox Flux", 10, "spell", 1,
         p("Once per long rest, you may enter a state of entropic energy that lasts until the end of the scene. While in "
           "this state, you may spend the GM's Fear as if spending Hope, up to 3 per spotlight. In similar fashion, the "
           "GM may spend your Hope as if spending Fear when using adversaries' features, but only once per adversary "
           "spotlight.",
           "The spell ends earlier if the GM has no Fear or if you have no Hope."),
         actions=[
             action("paradox.enter", "Enter Paradox", "effect", img="icons/magic/time/arrows-circling-pink.webp",
                    use=uses(1, "longRest"), target={"type": "self", "amount": None}, effects=[rid(paradox_eff)]),
         ],
         effects=[effect(paradox_eff, "", "Paradox Flux", img="icons/magic/time/arrows-circling-pink.webp", duration="scene",
                         desc=p("You may spend the GM's Fear as if spending Hope (up to 3 per spotlight); the GM may spend your Hope as Fear once per adversary spotlight."))])
    return cards


# ===========================================================================
# CLASSES & SUBCLASSES
# ===========================================================================

SYS_W = "Compendium.daggerheart.weapons.Item."
SYS_A = "Compendium.daggerheart.armors.Item."
SYS_CONS = "Compendium.daggerheart.consumables.Item."
# Shared "take" items + potion choices used by the core classes
TAKE = ["Compendium.daggerheart.classes.Item.zqeXrJTd1geX73Pw",
        "Compendium.daggerheart.classes.Item.hMST9iizQP1yz0MG",
        "Compendium.daggerheart.classes.Item.uoG5iq09mxJPXfmk"]
POTIONS = [SYS_CONS + "tPfKtKRRjv8qdSqy", SYS_CONS + "b6vGSPFWOlzZZDLO"]


def classes_and_subclasses():
    cls_docs, sub_docs = [], []

    # ------------------------------ ENCHANTER -------------------------------
    f_ench = folder("ench", "Enchanter", "#1f6f78")
    f_ench_items = folder("ench-items", "Class Items", parent=f_ench["_id"])
    fs_ench = folder("sub-ench", "Enchanter", "#1f6f78")
    cls_docs += [f_ench, f_ench_items]
    sub_docs.append(fs_ench)

    surge = feature("ench.surge", "Ingenious Surge", "icons/magic/light/hand-sparks-glow-yellow.webp",
                    p("<strong>Spend 3 Hope</strong> to enchant an object without marking a Stress. When you do so, the "
                      "enchantment doesn't count towards the limit of active enchantments you can have, but you're still "
                      "limited to a single enchantment per object."),
                    form="action", folder=f_ench["_id"],
                    actions=[action("ench.surge.use", "Ingenious Surge", "effect", _id=SPECIAL["surge"],
                                    img="icons/magic/light/hand-sparks-glow-yellow.webp",
                                    desc=p("Opens the Enchanting Workshop paying 3 Hope instead of a Stress."),
                                    target={"type": "self", "amount": None})])
    magical = feature("ench.magical", "Magical Enchantments", "icons/magic/fire/dagger-rune-enchant-flame-strong-blue.webp",
                      p("You may touch an object within Melee range and <strong>mark a Stress</strong> to grant it the "
                        "properties of a chosen enchantment of your Tier or lower. When attempting to place an enchantment "
                        "on an item held or worn by an adversary, you must also make a <strong>Spellcast Roll</strong> "
                        "against the target after marking a Stress. You can have only one enchantment active at a time, "
                        "which last until the end of the scene, you enchant a different item or otherwise specified.",
                        "<em>Use the action below (or the ✦ Wonder button on your sheet) to open the Enchanting Workshop.</em>"),
                      form="action", folder=f_ench["_id"],
                      actions=[action("ench.workshop", "Enchanting Workshop", "effect", _id=SPECIAL["workshop"],
                                      img="icons/magic/fire/dagger-rune-enchant-flame-strong-blue.webp",
                                      target={"type": "self", "amount": None}),
                               action("ench.vsAdversary", "Enchant Adversary's Item", "attack",
                                      img="icons/magic/symbols/rune-sigil-rough-white-teal.webp", rng="melee",
                                      desc=p("Spellcast Roll against the adversary holding or wearing the item."),
                                      roll_=roll("spellcast"), target={"type": "hostile", "amount": 1})])
    appraisal = feature("ench.appraisal", "Mystic Appraisal", "icons/magic/perception/eye-ringed-glow-angry-small-teal.webp",
                        p("You can sense the rhythm of magic in ordinary items. You may examine an item or creature within "
                          "Very Close range to uncover if it is magical. If it is an object, you can discern its properties "
                          "and understand its functions. If it is linked to a specific spell such as Rune Ward, Create "
                          "Construct or Shape Material, you also learn which spell it is."),
                        form="action", folder=f_ench["_id"],
                        actions=[action("ench.appraise", "Appraise", "effect", _id=SPECIAL["appraisal"],
                                        img="icons/magic/perception/eye-ringed-glow-angry-small-teal.webp",
                                        rng="veryClose", target={"type": "any", "amount": 1},
                                        desc=p("Target a token (or select an item) to reveal its magical properties in chat."))])
    pouch = base_item("ench.pouch", "Leather Pouch with Magical Crystals", "loot",
                      "icons/containers/bags/pouch-leather-pink.webp",
                      {"description": p("A leather pouch with magical crystals."), "quantity": 1, "actions": {},
                       "attribution": ATTR, "gmNotes": ""}, folder=f_ench_items["_id"])
    wand = base_item("ench.brokenWand", "Broken Wand", "loot", "icons/commodities/treasure/token-runed-spiral-grey.webp",
                     {"description": p("A broken wand that belonged to a powerful magician."), "quantity": 1,
                      "actions": {}, "attribution": ATTR, "gmNotes": ""}, folder=f_ench_items["_id"])
    cls_docs += [surge, magical, appraisal, pouch, wand]

    enchanter = base_item("class.enchanter", "Enchanter", "class", art("class-enchanter"), {
        "description": p("Enchanters are artisans who weave magic into objects with great insight. They study the "
                         "undertones of magic in traditional items and spells, creating innovative outcomes that empower "
                         "themselves and their allies. Guided by their unique perspective, enchanters shape the flow of "
                         "magic into masterful creations."),
        "domains": ["wonder", "codex"], "classItems": [], "hitPoints": 5, "evasion": 11,
        "features": [{"type": "hope", "item": uuid("wonder-classes", surge["_id"])},
                     {"type": "class", "item": uuid("wonder-classes", magical["_id"])},
                     {"type": "class", "item": uuid("wonder-classes", appraisal["_id"])}],
        "inventory": {"take": TAKE, "choiceA": POTIONS,
                      "choiceB": [uuid("wonder-classes", pouch["_id"]), uuid("wonder-classes", wand["_id"])]},
        "characterGuide": {"suggestedTraits": {"agility": 0, "strength": -1, "finesse": 2, "instinct": 0,
                                               "presence": 1, "knowledge": 1},
                           "suggestedPrimaryWeapon": SYS_W + "ItWisJFNGMNWeaCV",
                           "suggestedSecondaryWeapon": SYS_W + "zxKt6qXe7uZB6ljm",
                           "suggestedArmor": SYS_A + "nibfdNtp2PtxvbVz"},
        "isMulticlass": False, "attribution": ATTR,
        "backgroundQuestions": [
            "You learned your craft from someone. Who are they and what secrets have they shared with you?",
            "You believe every creation carries a piece of its maker. What part of you do you think your creations hold?",
            "You often talk to your creations when you work. What do you imagine they would say back?"],
        "connections": [
            "What magic do I sense on you, and why can I not identify its origin?",
            "I've been trying to recreate something you no longer have. What was it, and why does it matter to you?",
            "What object of mine do you secretly keep, and why have you not given it back?"],
        "gmNotes": "", "levelupOptionTiers": {"2": {}, "3": {}, "4": {}}},
        folder=f_ench["_id"], flags={MOD: {"wonderClass": "enchanter"}})
    cls_docs.append(enchanter)
    ench_uuid = uuid("wonder-classes", enchanter["_id"])

    # Appraiser
    ap = []
    ap.append(feature("ap.goodDeal", "A Good Deal", "icons/commodities/currency/coins-plain-pouch-gold.webp",
                      p("When negotiating prices, <strong>spend a Hope</strong> to increase or reduce the final price by "
                        "<strong>1d4</strong> handfuls of gold."), form="action", folder=fs_ench["_id"],
                      actions=[action("ap.goodDeal.roll", "Haggle", "attack",
                                      img="icons/commodities/currency/coins-plain-pouch-gold.webp",
                                      costs=[cost("hope", 1)], roll_=roll("diceSet", dice="d4", mult="flat"),
                                      target={"type": "self", "amount": None})]))
    ap.append(feature("ap.tinkering", "Creative Tinkering", "icons/commodities/tech/cog-brass.webp",
                      p("You may <em>Work on a Project</em> to create a magical trinket. When you do so, spend any number "
                        "of handfuls of gold up to your Tier, then roll a <strong>d8</strong> for each one spent. Choose an "
                        "item or consumable from the Loot tables with number equal to or lower than the total result of "
                        "your roll. You create a temporary copy of the chosen loot and it remains active until your next "
                        "long rest (or until used, if it is a consumable). Any creature can make a "
                        "<strong>Reaction Roll (10)</strong> to identify the created loot as a temporary copy."),
                      form="action", folder=fs_ench["_id"],
                      actions=[action("ap.tinker", "Tinkering Bench", "effect", _id=SPECIAL["tinkering"],
                                      img="icons/commodities/tech/cog-brass.webp", target={"type": "self", "amount": None})]))
    ap.append(feature("ap.expandedStock", "Expanded Stock", "icons/containers/chest/chest-simple-box-gold-brown.webp",
                      p("You may now have two enchantments active at the same time, but only one per object. Also, you no "
                        "longer need to touch an item to place an enchantment and can do so from within Close range of "
                        "the object."), folder=fs_ench["_id"], flags={MOD: {"enchantSlots": 2}}))
    ap.append(feature("ap.salvageKit", "Salvage Kit", "icons/containers/bags/coinpouch-simple-leather-brown.webp",
                      p("You can <strong>spend a Hope</strong> to make a <strong>Reaction Roll (13)</strong> when you or an "
                        "ally within Far range use a consumable. On a success, it is not spent. You may only use this "
                        "feature once per consumable."), form="reaction", folder=fs_ench["_id"],
                      actions=[action("ap.salvage", "Salvage", "attack", img="icons/containers/bags/coinpouch-simple-leather-brown.webp",
                                      action_type="reaction", costs=[cost("hope", 1)],
                                      roll_=roll("reaction", difficulty=13), rng="far",
                                      target={"type": "self", "amount": None})]))
    ap.append(feature("ap.resourceful", "Resourceful Craft", "icons/commodities/tech/cog-brass.webp",
                      p("You may choose an additional downtime move during a long rest, which you must use to "
                        "<em>Work on a Project</em> or <em>Prepare</em>. When using your Creative Tinkering feature, roll "
                        "an additional d8 and add it to the total result."), folder=fs_ench["_id"],
                      flags={MOD: {"tinkerExtraDie": 1}},
                      effects=[effect("ap.resourceful.rest", "", "Resourceful Craft",
                                      img="icons/commodities/tech/cog-brass.webp", transfer=True, duration="",
                                      changes=[chg("system.bonuses.rest.longRest.longMoves", 1)])]))
    ap.append(feature("ap.harmonious", "Harmonious Magic", "icons/magic/symbols/ring-circle-smoke-blue.webp",
                      p("While within Close range of at least one object enchanted by you, gain a <strong>+1</strong> "
                        "bonus to action rolls."), folder=fs_ench["_id"], flags={MOD: {"harmonious": True}},
                      effects=[effect("ap.harmonious.eff", "", "Harmonious Magic",
                                      img="icons/magic/symbols/ring-circle-smoke-blue.webp", transfer=True, duration="",
                                      disabled=True, desc=p("Turned on automatically while you are within Close range of a creature holding an object you enchanted."),
                                      changes=[chg("system.bonuses.roll.bonus", 1)])]))
    appraiser = base_item("sub.appraiser", "Appraiser", "subclass", art("sub-appraiser-specialization"), {
        "description": p("Play the Appraiser if you want to craft items to aid your allies in and outside of battle."),
        "spellcastingTrait": "finesse",
        "features": [{"type": t, "item": uuid("wonder-subclasses", f["_id"])}
                     for t, f in zip(["foundation", "foundation", "specialization", "specialization", "mastery", "mastery"], ap)],
        "featureState": 1, "isMulticlass": False, "attribution": ATTR, "linkedClass": ench_uuid, "gmNotes": ""},
        folder=fs_ench["_id"])
    sub_docs += ap + [appraiser]

    # Spellweaver
    sw = []
    sw.append(feature("sw.magicWeapons", "Magic Weapons", "icons/magic/fire/dagger-rune-enchant-flame-strong-red.webp",
                      p("You may use your Spellcast trait when attacking with weapons enchanted by you."),
                      folder=fs_ench["_id"], flags={MOD: {"magicWeapons": True}}))
    sw.append(feature("sw.spellweave", "Spellweave", "icons/magic/symbols/runes-triangle-magenta.webp",
                      p("Once per rest, <strong>mark a Stress</strong> to choose two of your spells that require a "
                        "Spellcast Roll against a single target. You may cast a combined spell by making a single "
                        "Spellcast Roll against the same target, which must be within range of the two spells. You must "
                        "spend any additional resources for each spell. When rolling for damage with your Spellweave, "
                        "combine the initial damage of both spells into a single damage roll."),
                      form="action", folder=fs_ench["_id"],
                      actions=[action("sw.weave", "Weave Spells", "attack", img="icons/magic/symbols/runes-triangle-magenta.webp",
                                      _id="wndSpellweave000",
                                      costs=[cost("stress", 1)], use=uses(1, "shortRest"), roll_=roll("spellcast"),
                                      target={"type": "any", "amount": 1})]))
    sw.append(feature("sw.adaptative", "Adaptative Learning", "icons/sundries/books/book-tooled-blue-yellow.webp",
                      p("Take an additional level 1 spell or grimoire card from a domain you normally cannot access. You "
                        "may change this choice when you gain a level."), folder=fs_ench["_id"]))
    sw.append(feature("sw.overcharged", "Overcharged", "icons/magic/lightning/orb-ball-spiral-blue.webp",
                      p("You may now place enchantments on items that already have features. You are still limited to a "
                        "single enchantment per object."), folder=fs_ench["_id"], flags={MOD: {"overcharged": True}}))
    sw.append(feature("sw.smallAppreciation", "Small Appreciation", "icons/commodities/gems/gem-fragments-blue.webp",
                      p("The Recall Cost of your level 1 domain cards is reduced by 1. Additionally, weapons enchanted by "
                        "you deal additional damage equal to the number of level 1 spells in your loadout."),
                      folder=fs_ench["_id"], flags={MOD: {"smallAppreciation": True}}))
    sw.append(feature("sw.creativeFlow", "Creative Flow", "icons/magic/air/wind-vortex-swirl-blue-purple.webp",
                      p("Regain the use of your Spellweave feature when you place an enchantment on an object."),
                      folder=fs_ench["_id"], flags={MOD: {"creativeFlow": True}}))
    spellweaver = base_item("sub.spellweaver", "Spellweaver", "subclass", art("sub-spellweaver-specialization"), {
        "description": p("Play the Spellweaver if you want to mix, improve and experiment with your weapons and spells."),
        "spellcastingTrait": "knowledge",
        "features": [{"type": t, "item": uuid("wonder-subclasses", f["_id"])}
                     for t, f in zip(["foundation", "foundation", "specialization", "specialization", "mastery", "mastery"], sw)],
        "featureState": 1, "isMulticlass": False, "attribution": ATTR, "linkedClass": ench_uuid, "gmNotes": ""},
        folder=fs_ench["_id"])
    sub_docs += sw + [spellweaver]

    # ------------------------------ STARGAZER -------------------------------
    f_star = folder("star", "Stargazer", "#2b3a67")
    f_star_items = folder("star-items", "Class Items", parent=f_star["_id"])
    fs_star = folder("sub-star", "Stargazer", "#2b3a67")
    cls_docs += [f_star, f_star_items]
    sub_docs.append(fs_star)

    empyrean = feature("star.empyrean", "Empyrean Call", "icons/magic/light/explosion-star-large-blue-yellow.webp",
                       p("<strong>Spend 3 Hope</strong> while in Constellation form to gain <strong>1d4</strong> Astral tokens."),
                       form="action", folder=f_star["_id"],
                       actions=[action("star.empyrean.use", "Empyrean Call", "effect", _id=SPECIAL["empyrean"],
                                       img="icons/magic/light/explosion-star-large-blue-yellow.webp",
                                       target={"type": "self", "amount": None},
                                       desc=p("Spend 3 Hope (less with Cosmic Help) to gain 1d4 Astral tokens."))])
    chart = feature("star.chart", "Star Chart", "icons/magic/symbols/runes-star-pentagon-blue.webp",
                    p("You have a whimsical Star Chart of the skies above representing the different stars, planets and "
                      "constellations. Describe what it looks like and how you activate it.",
                      "<strong>Mark a Stress</strong> to activate your Star Chart and embody your Constellation form. You "
                      "gain access to a standard attack and additional features according to the stars you have marked in "
                      "your Star Chart. When you obtain a Foundation card for this class or gain a level, choose a new "
                      "star to mark in your Chart.",
                      "When you transform, place a number of tokens on your character sheet equal to your Spellcast trait "
                      "(minimum 1). These are your <em>Astral tokens</em>, and you may have a maximum of 6. When you make "
                      "an action roll while in Constellation form, you must spend an Astral token. You can remain in this "
                      "form until you have no Astral tokens left. You also drop out of your Constellation form if you mark "
                      "your last Hit Point.",
                      "<em>Standard attack: Melee, uses your Spellcast trait, d6 magic damage using your Proficiency.</em>"),
                    form="action", folder=f_star["_id"],
                    actions=[action("star.chart.open", "Open Star Chart", "effect", _id=SPECIAL["starChart"],
                                    img="icons/magic/symbols/runes-star-pentagon-blue.webp",
                                    target={"type": "self", "amount": None}),
                             action("star.chart.form", "Embody Constellation", "effect", _id=SPECIAL["constellation"],
                                    img="icons/magic/light/explosion-star-glow-blue-purple.webp",
                                    desc=p("Mark a Stress to enter (or leave) your Constellation form."),
                                    target={"type": "self", "amount": None})])
    motes = feature("star.motes", "Motes of Light", "icons/magic/light/orbs-firefly-hand-yellow.webp",
                    p("You can conjure star-like motes of light that hover in your hand or around a point of your choice "
                      "within Far range. They stay active while you remain within Far range of them."),
                    folder=f_star["_id"], form="action",
                    actions=[action("star.motes.conjure", "Conjure Motes", "effect", img="icons/magic/light/orbs-firefly-hand-yellow.webp",
                                    target={"type": "self", "amount": None}, rng="far", effects=[rid("star.motes.light")])],
                    effects=[effect("star.motes.light", "", "Motes of Light", img="icons/magic/light/orbs-firefly-hand-yellow.webp",
                                    transfer=False, duration="scene",
                                    desc=p("Star-like motes of light hover around you."),
                                    changes=[chg("token.light.dim", 6, "override"), chg("token.light.bright", 2, "override"),
                                             chg("token.light.color", "#a9c8ff", "override")])])
    amap = base_item("star.map", "Astral Map of Someone Unknown", "loot", "icons/sundries/books/book-backed-wood-tan.webp",
                     {"description": p("An astral map of someone unknown to you."), "quantity": 1, "actions": {},
                      "attribution": ATTR, "gmNotes": ""}, folder=f_star_items["_id"])
    sext = base_item("star.sextant", "Sextant That Doesn't Seem to Work", "loot",
                     "icons/commodities/treasure/brooch-gold-eye-green.webp",
                     {"description": p("A sextant that doesn't seem to work."), "quantity": 1, "actions": {},
                      "attribution": ATTR, "gmNotes": ""}, folder=f_star_items["_id"])
    cls_docs += [empyrean, chart, motes, amap, sext]

    stargazer = base_item("class.stargazer", "Stargazer", "class", art("class-stargazer"), {
        "description": p("Stargazers are mystics who study the stars to unlock their cosmic power, blending astronomy, "
                         "astrology, and arcane insight. They read celestial patterns in the stars and assume the form of "
                         "Constellations to aid allies in battle. They are known to channel the intricate energies of the "
                         "cosmos, bridging the mundane world and the skies above."),
        "domains": ["wonder", "splendor"], "classItems": [], "hitPoints": 6, "evasion": 10,
        "features": [{"type": "hope", "item": uuid("wonder-classes", empyrean["_id"])},
                     {"type": "class", "item": uuid("wonder-classes", chart["_id"])},
                     {"type": "class", "item": uuid("wonder-classes", motes["_id"])}],
        "inventory": {"take": TAKE, "choiceA": POTIONS,
                      "choiceB": [uuid("wonder-classes", amap["_id"]), uuid("wonder-classes", sext["_id"])]},
        "characterGuide": {"suggestedTraits": {"agility": 0, "strength": -1, "finesse": 1, "instinct": 1,
                                               "presence": 0, "knowledge": 2},
                           "suggestedPrimaryWeapon": SYS_W + "3whiedn0jBMNRdIb",
                           "suggestedSecondaryWeapon": SYS_W + "mxwWKDujgsRcZWPT",
                           "suggestedArmor": SYS_A + "yJFp1bfpecDcStVK"},
        "isMulticlass": False, "attribution": ATTR,
        "backgroundQuestions": [
            "You once received a vision from the stars that still haunts you to this day. What did the stars show you?",
            "You were born under a special celestial event. What was it and what prophecy was spoken at your birth?",
            "What is the most beautiful thing you've ever seen in the sky?"],
        "connections": [
            "What did I predict about you that you promised would never happen?",
            "What do I always say you're destined for, and why do you hate hearing it?",
            "Who do you know from my life before we met, and why have you not told me yet?"],
        "gmNotes": "", "levelupOptionTiers": {"2": {}, "3": {}, "4": {}}},
        folder=f_star["_id"], flags={MOD: {"wonderClass": "stargazer"}})
    cls_docs.append(stargazer)
    star_uuid = uuid("wonder-classes", stargazer["_id"])

    # Astrologer
    asf = []
    asf.append(feature("as.celestial", "Celestial Blessing", "icons/magic/symbols/star-yellow.webp",
                       p("Choose an additional star to mark in your Star Chart."), folder=fs_star["_id"],
                       flags={MOD: {"extraStars": 1}}))
    asf.append(feature("as.binary", "Binary Stars", "icons/magic/light/projectiles-star-purple.webp",
                       p("When you assume your Constellation form, you may choose an ally within Far range to be your "
                         "Binary Star. While you are within Close range of your Binary Star, they add <strong>+1</strong> "
                         "to their Evasion, you can use your standard attack without having to spend an Astral token and "
                         "it costs one less Hope to initiate a Tag Team Roll between the two of you. You must still spend "
                         "Astral tokens to activate any features related to your standard attack."),
                       folder=fs_star["_id"], flags={MOD: {"binaryStars": True}}))
    asf.append(feature("as.radiant", "Radiant Blessing", "icons/magic/symbols/star-rising-purple.webp",
                       p("Choose an additional star to mark in your Star Chart."), folder=fs_star["_id"],
                       flags={MOD: {"extraStars": 1}}))
    asf.append(feature("as.gravity", "Gravity Pull", "icons/magic/sonic/projectile-sound-rings-wave.webp",
                       p("When your Binary Star would mark any number of Hit Points, you may spend 2 Astral tokens to pull "
                         "them within your Melee range and reduce the number of Hit Points they mark by 1."),
                       form="reaction", folder=fs_star["_id"], flags={MOD: {"gravityPull": True}}))
    asf.append(feature("as.stellar", "Stellar Blessing", "icons/magic/symbols/star-inverted-yellow.webp",
                       p("Choose an additional star to mark in your Star Chart."), folder=fs_star["_id"],
                       flags={MOD: {"extraStars": 1}}))
    asf.append(feature("as.outOfOrbit", "Out of Orbit", "icons/magic/symbols/circle-ouroboros.webp",
                       p("You and your Binary Star now gain the feature's benefits while within Far range of each other. "
                         "Whenever you use a feature, domain card or make an attack, you may consider your Binary Star's "
                         "current location as the point of origin of the effect."),
                       folder=fs_star["_id"], flags={MOD: {"outOfOrbit": True}}))
    astrologer = base_item("sub.astrologer", "Astrologer", "subclass", art("sub-astrologer-specialization"), {
        "description": p("Play the Astrologer if you want to support a chosen ally while channeling the cosmic forces "
                         "within yourself."),
        "spellcastingTrait": "knowledge",
        "features": [{"type": t, "item": uuid("wonder-subclasses", f["_id"])}
                     for t, f in zip(["foundation", "foundation", "specialization", "specialization", "mastery", "mastery"], asf)],
        "featureState": 1, "isMulticlass": False, "attribution": ATTR, "linkedClass": star_uuid, "gmNotes": ""},
        folder=fs_star["_id"])
    sub_docs += asf + [astrologer]

    # Clairvoyant
    cl = []
    glimpse_id = rid("item:cl.glimpse")
    cl.append(feature("cl.glimpse", "Glimpse Beyond", "icons/magic/perception/orb-crystal-ball-scrying-blue.webp",
                      p("In the beginning of a session, roll <strong>2d4</strong> and place them on this card. These are "
                        "your <em>Glimpse dice</em>. When a target makes an action roll, you may spend one of your Glimpse "
                        "dice to reduce or increase the final result equal to the die's value. Discard any unspent Glimpse "
                        "dice at the end of a session."),
                      res=resource(0, "2", "fa-solid fa-eye", rtype="diceValue", faces="d4", recovery="session"),
                      form="action", folder=fs_star["_id"], flags={MOD: {"glimpse": True}},
                      actions=[action("cl.glimpse.open", "Glimpse Dice", "effect", _id=SPECIAL["glimpse"],
                                      img="icons/magic/perception/orb-crystal-ball-scrying-blue.webp",
                                      target={"type": "any", "amount": 1})]))
    cl.append(feature("cl.cosmicHelp", "Cosmic Help", "icons/magic/light/beam-rays-yellow-blue-large.webp",
                      p("When you Help an Ally or initiate a Tag Team Roll while in Constellation form, your next Empyrean "
                        "Call costs one less Hope. You may benefit from this feature only once per rest for each ally."),
                      folder=fs_star["_id"], flags={MOD: {"cosmicHelp": True}}))
    third_eye = "effect:cl.thirdEye"
    cl.append(feature("cl.thirdEye", "Third Eye", "icons/magic/perception/third-eye-blue-red.webp",
                      p("Once per rest, <strong>spend a Hope</strong> to gain celestial insight until the end of the scene. "
                        "For the duration of this effect, you can see through invisibility or magical darkness and creatures "
                        "within Very Close range cannot be <em>Hidden</em> from you."),
                      form="action", folder=fs_star["_id"],
                      actions=[action("cl.thirdEye.use", "Open the Third Eye", "effect",
                                      img="icons/magic/perception/third-eye-blue-red.webp",
                                      costs=[cost("hope", 1)], use=uses(1, "shortRest"),
                                      target={"type": "self", "amount": None}, effects=[rid(third_eye)])],
                      effects=[effect(third_eye, "", "Third Eye", img="icons/magic/perception/third-eye-blue-red.webp",
                                      duration="scene",
                                      desc=p("You see through invisibility and magical darkness; creatures within Very "
                                             "Close range cannot be Hidden from you."))]))
    cl.append(feature("cl.written", "Written in the Stars", "icons/magic/symbols/runes-star-orange-purple.webp",
                      p("Your Glimpse dice increase to d6s. When you participate in a Tag Team Roll, you may choose to "
                        "reroll any number of remaining Glimpse dice."), folder=fs_star["_id"],
                      flags={MOD: {"glimpseFaces": "d6"}}))
    cl.append(feature("cl.againstOdds", "Against the Odds", "icons/magic/symbols/question-stone-yellow.webp",
                      p("When you spend an Astral token to make an action roll and roll a failure with Hope, regain the "
                        "spent Astral token."), folder=fs_star["_id"], flags={MOD: {"againstTheOdds": True}}))
    cl.append(feature("cl.twist", "Twist of Fate", "icons/magic/time/hourglass-brown-orange.webp",
                      p("Roll an additional Glimpse die in the beginning of a session.",
                        "When you Help an Ally while in Constellation form and they roll with Fear, you may spend an "
                        "Astral token to change the result to a roll with Hope instead."),
                      folder=fs_star["_id"], flags={MOD: {"glimpseExtra": 1}}))
    clair = base_item("sub.clairvoyant", "Clairvoyant", "subclass", art("sub-clairvoyant-specialization"), {
        "description": p("Play the Clairvoyant if you want to use the stars as guidance to help your allies."),
        "spellcastingTrait": "instinct",
        "features": [{"type": t, "item": uuid("wonder-subclasses", f["_id"])}
                     for t, f in zip(["foundation", "foundation", "specialization", "specialization", "mastery", "mastery"], cl)],
        "featureState": 1, "isMulticlass": False, "attribution": ATTR, "linkedClass": star_uuid, "gmNotes": ""},
        folder=fs_star["_id"])
    sub_docs += cl + [clair]
    return cls_docs, sub_docs


# ===========================================================================
# ENCHANTMENTS (reference items, one per enchantment)
# ===========================================================================

def enchantment_items():
    data = json.load(open(os.path.join(ROOT, "data", "enchantments.json")))
    docs = []
    tiers = {}
    for t in range(1, 5):
        tiers[t] = folder(f"ench-tier-{t}", f"Tier {t}", ["#4c8c6b", "#3c6f9c", "#7a4ea3", "#a3404e"][t - 1], sort=t)
        docs.append(tiers[t])
    for e in data["enchantments"]:
        target_label = data["targets"][e["target"]]["label"]
        desc = p(e["text"])
        if e.get("feature"):
            desc += p(f"<strong>{e['feature']['name']}:</strong> {e['feature']['text']}")
        desc = f"<p><em>Tier {e['tier']} enchantment — {target_label}</em></p>" + desc
        it = feature(f"ench.{e['key']}", e["name"], e["img"], desc, folder=tiers[e["tier"]]["_id"],
                     flags={MOD: {"enchantment": e["key"], "tier": e["tier"]}})
        it["sort"] = e["tier"] * 1000 + len(docs)
        docs.append(it)
    return docs


# ===========================================================================
# MACROS
# ===========================================================================

def macros():
    defs = [
        ("starChart", "Star Chart", "icons/magic/symbols/runes-star-pentagon-blue.webp",
         "game.modules.get('daggerheart-wonderdomain')?.api?.openStarChart(actor ?? game.user.character);"),
        ("constellation", "Toggle Constellation Form", "icons/magic/light/explosion-star-glow-blue-purple.webp",
         "game.modules.get('daggerheart-wonderdomain')?.api?.toggleConstellation(actor ?? game.user.character);"),
        ("workshop", "Enchanting Workshop", "icons/magic/fire/dagger-rune-enchant-flame-strong-blue.webp",
         "game.modules.get('daggerheart-wonderdomain')?.api?.openWorkshop(actor ?? game.user.character);"),
        ("tinkering", "Tinkering Bench", "icons/commodities/tech/cog-brass.webp",
         "game.modules.get('daggerheart-wonderdomain')?.api?.openTinkering(actor ?? game.user.character);"),
        ("glimpse", "Glimpse Dice", "icons/magic/perception/orb-crystal-ball-scrying-blue.webp",
         "game.modules.get('daggerheart-wonderdomain')?.api?.openGlimpse(actor ?? game.user.character);"),
        ("installArt", "Install Wonder Card Art", "icons/sundries/books/book-embossed-gold-red.webp",
         "game.modules.get('daggerheart-wonderdomain')?.api?.installArt();"),
        ("hub", "Wonder Hub", f"modules/{MOD}/assets/wonder.svg",
         "game.modules.get('daggerheart-wonderdomain')?.api?.openHub(actor ?? game.user.character);"),
    ]
    out = []
    for key, name, img, cmd in defs:
        _id = rid("macro:" + key)
        out.append({"_id": _id, "name": name, "type": "script", "img": ic(img), "command": cmd, "scope": "global",
                    "author": None, "folder": None, "sort": 0, "flags": {}, "ownership": {"default": 2},
                    "_key": f"!macros!{_id}"})
    return out


# ===========================================================================
# JOURNAL
# ===========================================================================

def journal(cards, cls_docs, sub_docs):
    jid = rid("journal:guide")

    def page(key, name, html, sort):
        _id = rid("page:" + key)
        return {"_id": _id, "name": name, "type": "text", "sort": sort, "title": {"show": True, "level": 1},
                "image": {}, "text": {"format": 1, "content": html}, "video": {"controls": True, "volume": 0.5},
                "src": None, "system": {}, "category": None, "ownership": {"default": -1}, "flags": {},
                "_key": f"!journal.pages!{jid}.{_id}"}

    def link(pack, doc):
        return f"@UUID[Compendium.{MOD}.{pack}.Item.{doc['_id']}]{{{doc['name']}}}"

    by_level = {}
    for c in cards:
        by_level.setdefault(c["system"]["level"], []).append(c)
    rows = "".join(
        f"<tr><td>{lvl}</td><td>{', '.join(link('wonder-domain', c) for c in by_level[lvl])}</td></tr>"
        for lvl in sorted(by_level))

    intro = (
        f'<p><img src="{art("domain-wonder")}" style="width:100%;border:none" alt=""></p>'
        "<h2>Como usar este módulo</h2>"
        "<p>O módulo <strong>Wonder Domain</strong> adiciona o domínio <em>Wonder</em> (21 cartas), as classes "
        "<strong>Enchanter</strong> (Wonder &amp; Codex) e <strong>Stargazer</strong> (Wonder &amp; Splendor), suas "
        "subclasses e todas as mecânicas especiais.</p>"
        "<ul>"
        "<li><strong>Criação de personagem:</strong> as classes aparecem no navegador de compêndios do sistema. Arraste "
        "a classe, a subclasse e as cartas para a ficha normalmente.</li>"
        "<li><strong>Botão ✦ Wonder:</strong> fichas com uma classe Wonder ganham um botão no cabeçalho que abre o "
        "<em>Wonder Hub</em> com atalhos para tudo.</li>"
        "<li><strong>Enchanter:</strong> a <em>Oficina de Encantamentos</em> mostra os encantamentos do seu Tier como "
        "cartas, filtra os itens válidos, paga o custo (Stress ou 3 Hope com Ingenious Surge), controla o limite de "
        "encantamentos ativos e aplica os efeitos mecânicos ao item (Protective, Reliable, Quick, Powerful, limiares, "
        "Evasão etc.). O <em>Tinkering Bench</em> rola os d8 de Creative Tinkering e lista o loot disponível.</li>"
        "<li><strong>Stargazer:</strong> a <em>Carta Estelar</em> é interativa: clique nas estrelas conectadas para "
        "marcá-las. O botão <em>Embody Constellation</em> marca 1 Stress, coloca as Astral tokens e aplica a forma "
        "(ataque padrão, Evasão, slots extras, voo, resistência). Cada action roll na forma gasta uma Astral token "
        "automaticamente.</li>"
        "<li><strong>Clairvoyant:</strong> o painel de <em>Glimpse dice</em> rola os dados no início da sessão e "
        "permite gastá-los com um clique (+ ou −), anunciando no chat.</li>"
        "</ul>"
        "<h2>Wonder Domain</h2>"
        "<p><em>The Wonder domain embodies the spark of imagination, the excitement of discovery, and the power of "
        "creativity. Those who draw from Wonder see the world as it could be: brighter, different, interesting and "
        "beautiful. They are known as artists, scholars, inventors, and dreamers. Wonder transforms the surroundings, "
        "creating new experiences while daring to ask ‘what if’.</em></p>"
        f"<table><thead><tr><th>Level</th><th>Cards</th></tr></thead><tbody>{rows}</tbody></table>"
        "<hr><p><small>Design: Reno Reizakki. Revision: Martin Groene, Jere Lahtonen. This product includes materials "
        "from the Daggerheart System Reference Document 1.0, © Critical Role, LLC. under the terms of the Darrington "
        "Press Community Gaming (DPCGL) License. More information can be found at https://www.daggerheart.com.</small></p>"
    )

    def cls_page(cls, subs):
        out = f"<p>{link('wonder-classes', cls)}</p>" + cls["system"]["description"]
        out += f"<p><strong>Domains:</strong> {' &amp; '.join(d.capitalize() for d in cls['system']['domains'])} · " \
               f"<strong>Evasion:</strong> {cls['system']['evasion']} · <strong>Hit Points:</strong> {cls['system']['hitPoints']}</p>"
        for s in subs:
            out += f"<h3>{link('wonder-subclasses', s)} <small>(Spellcast: {s['system']['spellcastingTrait'].capitalize()})</small></h3>"
            out += s["system"]["description"]
        return out

    classes = {d["flags"].get(MOD, {}).get("wonderClass"): d for d in cls_docs if d.get("type") == "class"}
    subs = [d for d in sub_docs if d.get("type") == "subclass"]
    ench_subs = [s for s in subs if s["name"] in ("Appraiser", "Spellweaver")]
    star_subs = [s for s in subs if s["name"] in ("Astrologer", "Clairvoyant")]

    ench_data = json.load(open(os.path.join(ROOT, "data", "enchantments.json")))
    ench_rows = ""
    for t in range(1, 5):
        ench_rows += f"<h3>Tier {t}</h3><ul>"
        for e in [x for x in ench_data["enchantments"] if x["tier"] == t]:
            ench_rows += f"<li><strong>{e['name']}</strong> — {e['text']}"
            if e.get("feature"):
                ench_rows += f" <em>{e['feature']['name']}: {e['feature']['text']}</em>"
            ench_rows += "</li>"
        ench_rows += "</ul>"

    star_page = (
        "<p>Your Star Chart showcases the abilities you channel when you embody your Constellation. Any features granted "
        "by your Star Chart are active only while you are in Constellation form. When you gain a level, you unlock a new "
        "star in your Star Chart and mark it. You may only unlock a star that is connected with a dotted line to another "
        "star you already have marked.</p>"
        "<p>If a Constellation feature grants you additional resources to mark such as Hope or Armor slots, Hope marked "
        "there is lost when you lose your Constellation form, but Armor slots remain marked even if you drop out of your "
        "Constellation form.</p>"
        "<p><strong>Standard attack:</strong> Melee · Spellcast trait · d6 magic damage using your Proficiency. "
        "Range steps: Melee → Very Close → Close → Far → Very Far. Die steps: d6 → d8 → d10 → d12.</p>"
        "<p>Abra a Carta Estelar pela ação <em>Open Star Chart</em> da feature Star Chart, pelo botão ✦ Wonder da ficha "
        "ou pela macro do compêndio.</p>"
    )

    pages = [
        page("intro", "Wonder Domain", intro, 100000),
        page("enchanter", "Enchanter", cls_page(classes["enchanter"], ench_subs), 200000),
        page("enchantments", "Magical Enchantments", ench_rows, 300000),
        page("stargazer", "Stargazer", cls_page(classes["stargazer"], star_subs), 400000),
        page("starchart", "Star Chart", star_page, 500000),
    ]
    return [{"_id": jid, "name": "Wonder Domain — Guide", "folder": None, "categories": [], "sort": 0, "flags": {},
             "pages": pages, "ownership": {"default": 2}, "_key": f"!journal!{jid}"}]


# ===========================================================================

def write_pack(name, docs):
    out = os.path.join(SRC, name)
    if os.path.exists(out):
        shutil.rmtree(out)
    os.makedirs(out)
    for d in docs:
        kind = "folders" if d["_key"].startswith("!folders!") else (d.get("type") or "doc")
        safe = "".join(ch if ch.isalnum() else "_" for ch in d["name"])
        with open(os.path.join(out, f"{kind}_{safe}_{d['_id']}.json"), "w") as fh:
            json.dump(d, fh, indent=2, ensure_ascii=False)
    print(f"  {name}: {len(docs)} documents")


def main():
    cards = domain_cards()
    # patch effect keys for card effects (they were created before the card id was known)
    cls_docs, sub_docs = classes_and_subclasses()
    for coll in (cls_docs, sub_docs):
        for d in coll:
            for e in d.get("effects", []):
                e["_key"] = f"!items.effects!{d['_id']}.{e['_id']}"
    ids = [d["_id"] for d in cards + cls_docs + sub_docs]
    assert len(ids) == len(set(ids)), "duplicate ids"
    print("Writing packs:")
    write_pack("wonder-domain", cards)
    write_pack("wonder-classes", cls_docs)
    write_pack("wonder-subclasses", sub_docs)
    write_pack("wonder-enchantments", enchantment_items())
    write_pack("wonder-macros", macros())
    write_pack("wonder-guide", journal(cards, cls_docs, sub_docs))


if __name__ == "__main__":
    main()
