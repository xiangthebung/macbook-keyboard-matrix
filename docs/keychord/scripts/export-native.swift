import Foundation
import KeyChordCore

let nativeDirectory = CommandLine.arguments[1]
let outputPath = CommandLine.arguments[2]
let outcome = DictionaryLoader.load(sources: Dictionary(uniqueKeysWithValues: DataFile.allCases.map { ($0, Optional($0.defaultSource)) }), rolloverLimit: 6)
guard outcome.problems.isEmpty else { fatalError("Native bundled mappings did not validate: \(outcome.problems)") }
let data = outcome.data
let layout = data.layout
func names(_ keys: KeySet) -> [String] { layout.names(keys) }
func command(_ c: Command) -> String {
    switch c {
    case .undo: return "undo"
    case .modeSwitch: return "modeSwitch"
    case .capitalizeNext: return "capitalizeNext"
    case .snippetExit: return "snippetExit"
    case .casing(let m): return "casing:" + m.rawValue
    case .endIdentifier: return "endIdentifier"
    }
}
func skill(_ s: Course.Skill) -> String {
    switch s {
    case let .sound(b, t): return "sound:" + b.rawValue + ":" + t
    case .pairs(let b): return "pairs:" + b.rawValue
    case .word(let t): return "word:" + t
    case .ending(let t): return "ending:" + t
    case .symbol(let t): return "symbol:" + t
    case .abbreviation(let t): return "abbreviation:" + t
    case .command(let c): return "command:" + command(c)
    case .join: return "join"
    case .shiftJoin: return "shiftJoin"
    case .space: return "space"
    case .spell: return "spell"
    case .capitalLetter: return "capitalLetter"
    case .digits: return "digits"
    case .newLine: return "newLine"
    }
}
func entry(_ e: Entry) -> [String: Any] {
    switch e {
    case .command(let c): return ["type": "command", "command": command(c), "description": KeyMeanings.describe(c)]
    case .text(let t): return ["type": "text", "text": t.text, "cursorFromEnd": t.cursorFromEnd as Any? ?? NSNull(),
        "kind": t.kind.rawValue, "attachLeft": t.attachLeft, "attachRight": t.attachRight, "wordAttach": t.wordAttach,
        "glue": t.glue, "capitalizeNext": t.capitalizeNext]
    }
}
func entries(_ d: ChordDictionary) -> [[String: Any]] {
    d.entries.sorted { $0.key.bits < $1.key.bits }.map { ["keys": names($0.key), "entry": entry($0.value)] }
}
// Public EngineContext is opaque in Swift. Mirror exports its value fields for parity fixtures only.
func reflected(_ v: Any) -> Any {
    if let v = v as? String { return v }
    if let v = v as? Bool { return v }
    if let v = v as? Int { return v }
    if let v = v as? OutputKind { return v.rawValue }
    if let v = v as? CasingMode { return v.rawValue }
    let m = Mirror(reflecting: v)
    if m.displayStyle == .optional { return m.children.first.map { reflected($0.value) } ?? NSNull() }
    if m.displayStyle == .collection { return m.children.map { reflected($0.value) } }
    var d: [String: Any] = [:]
    for c in m.children { if let key = c.label { d[key] = reflected(c.value) } }
    return d
}
func context(_ c: EngineContext) -> Any {
    let m = Mirror(reflecting: c)
    return m.children.first.map { reflected($0.value) } ?? NSNull()
}
func action(_ a: OutputAction) -> [String: Any] {
    switch a {
    case .insert(let t): return ["type": "insert", "text": t]
    case .deleteBackward(let n): return ["type": "deleteBackward", "count": n]
    case .deleteForward(let n): return ["type": "deleteForward", "count": n]
    case .moveLeft(let n): return ["type": "moveLeft", "count": n]
    case .moveRight(let n): return ["type": "moveRight", "count": n]
    }
}
func guide(_ g: TypingGuide, text: String) -> [String: Any] {
    let steps: [[String: Any]] = g.steps.map { s in
        let a: [String: Any]
        switch s.action {
        case .chord(let keys, let shift): a = ["type": "chord", "keys": keys, "shift": shift]
        case .key(let k): a = ["type": "key", "key": k.rawValue]
        case .typeNormally(let t): a = ["type": "normal", "text": t]
        }
        return ["action": a, "kind": s.kind.rawValue, "output": s.output, "note": s.note,
            "source": [s.source.lowerBound, s.source.upperBound], "group": s.group,
            "textEnd": s.textEnd, "tail": s.tail, "contextAfter": s.contextAfter.map(context) ?? NSNull(),
            "parts": s.parts.map { ["text": $0.text, "keys": $0.keys, "role": $0.role.rawValue] },
            "skills": Course.skills(of: s, data: data, mode: g.mode).map(skill).sorted()]
    }
    return ["text": text, "mode": g.mode.rawValue, "steps": steps, "chordCount": g.chordCount,
        "normalCount": g.normalCount, "validated": true, "nativeValidated": true]
}
let isoWiring = try KeyboardWiring.parse(DefaultData.wiringMacBookPro18, layout: layout)
let ansiWiring = try KeyboardWiring.parse(DefaultData.wiringMacBookPro18ANSI, layout: layout)
let profiles: [(id: String, label: String, wiring: KeyboardWiring?)] = [
    ("generic", "Other keyboard · six-key limit", nil),
    ("macbook-ansi", "2021 MacBook Pro · US ANSI", ansiWiring),
    ("macbook-iso", "2021 MacBook Pro · Canadian French ISO", isoWiring)
]
func usable(_ profile: String) -> (KeySet) -> Bool {
    let wiring = profiles.first { $0.id == profile }!.wiring
    return { $0.count <= 6 && !(wiring?.blocks($0.indices.map { layout.keys[$0].code }) ?? false) }
}
func wiring(_ w: KeyboardWiring) -> [String: Any] {
    ["hardware": w.hardware, "rows": w.rows, "columns": w.columns,
     "positions": w.position.sorted { $0.key < $1.key }.map { ["code": Int($0.key), "row": $0.value.row, "column": $0.value.column] },
     "otherKeys": w.otherKeys.sorted { ($0.row, $0.column) < ($1.row, $1.column) }.map { ["row": $0.row, "column": $0.column] },
     "solo": w.solo.map(Int.init)]
}
let codeByName: [String: String] = ["Grave": "Backquote", "Minus": "Minus", "Equal": "Equal", "LBracket": "BracketLeft", "RBracket": "BracketRight", "Backslash": "Backslash", "Semicolon": "Semicolon", "Quote": "Quote", "Comma": "Comma", "Period": "Period", "Slash": "Slash", "Space": "Space"]
func browserCode(_ k: KeyDef) -> String {
    if let c = codeByName[k.name] { return c }
    if k.name.count == 1, k.name.first!.isNumber { return "Digit" + k.name }
    if k.name.count == 1, k.name.first!.isLetter { return "Key" + k.name }
    return "Unmapped" + String(k.code)
}
func geometry(_ g: KeyboardGeometry) -> [String: Any] {
    ["name": g.name, "kind": g.kind.rawValue, "width": KeyboardGeometry.width, "height": KeyboardGeometry.height,
     "keys": g.keys.map { ["code": Int($0.code), "label": $0.label, "shifted": $0.shifted as Any? ?? NSNull(), "x": $0.x, "y": $0.y, "width": $0.width, "height": $0.height, "small": $0.small] }]
}
func meaning(_ mode: SubMode) -> [String: Any] {
    let m = KeyMeanings(data: data, mode: mode)
    return ["keys": layout.keys.map { k -> [String: Any] in
        guard let v = m.keys[k.code] else { return [:] }
        return ["name": k.name, "code": Int(k.code), "role": v.role.rawValue, "label": v.label, "alone": v.alone as Any? ?? NSNull()]
    }, "capitalKey": m.capitalKey as Any? ?? NSNull(), "spellKey": m.spellKey as Any? ?? NSNull(),
      "undoKeys": m.undoKeys.map(names) ?? [], "capitalizeNextKeys": m.capitalizeNextKeys.map(names) ?? [], "modeSwitchKeys": m.modeSwitchKeys.map(names) ?? []]
}
var courseSteps: [[String: Any]] = []
for (index, s) in Course.steps.enumerated() {
    var guides: [String: Any] = [:], variants: [String: Any] = [:]
    for p in profiles {
        let accepts = usable(p.id)
        guides[p.id] = guide(TypingPlanner(data: data, mode: s.mode, usable: accepts).plan(s.text), text: s.text)
        var generated: [[String: Any]] = []
        if let generator = PracticeGenerator(source: .course(index), data: data, usable: accepts) {
            var previous = s.text
            for seed in 1...4 {
                if let next = generator.next(seed: UInt64(seed), avoiding: previous), next.text != s.text {
                    generated.append(["text": next.text, "guide": guide(next.guide, text: next.text), "seed": seed])
                    previous = next.text
                }
            }
        }
        variants[p.id] = generated
    }
    let introductions: [[String: Any]] = s.new.map { sk in
        ["skill": skill(sk), "chords": Course.introductionChords(for: sk, at: index, data: data).map { c in
            ["label": c.label, "keys": names(c.keys), "shift": c.shift, "role": c.role?.rawValue as Any? ?? NSNull(), "note": c.note as Any? ?? NSNull()]
        }]
    }
    let pos = Course.position(of: index)
    courseSteps.append(["id": s.id, "index": index, "unitIndex": pos.unit, "unitStepIndex": pos.step,
        "title": s.title, "intro": s.intro, "new": s.new.map(skill), "mode": s.mode.rawValue,
        "text": s.text, "introductions": introductions, "guides": guides, "variants": variants,
        "taught": Course.taught(through: index, data: data).map(skill).sorted()])
    FileHandle.standardError.write(Data("Exported course \(index + 1)/\(Course.steps.count): \(s.id)\n".utf8))
}
var topics: [[String: Any]] = []
for (index, t) in Lessons.all.enumerated() {
    var guides: [String: Any] = [:], variants: [String: Any] = [:]
    for p in profiles {
        guides[p.id] = guide(TypingPlanner(data: data, mode: t.mode, usable: usable(p.id)).plan(t.text), text: t.text)
        var generated: [[String: Any]] = []
        if let gen = PracticeGenerator(source: .topic(index), data: data, usable: usable(p.id)) {
            var previous = t.text
            for seed in 1...4 { if let next = gen.next(seed: UInt64(seed), avoiding: previous) {
                generated.append(["text": next.text, "guide": guide(next.guide, text: next.text), "seed": seed]); previous = next.text
            } }
        }
        variants[p.id] = generated
    }
    topics.append(["index": index, "title": t.title, "summary": t.summary, "text": t.text, "mode": t.mode.rawValue, "guides": guides, "variants": variants])
}
let listeningSource = try String(contentsOfFile: nativeDirectory + "/Sources/KeyChordCore/ListeningPractice.swift", encoding: .utf8)
let vocabulary = listeningSource.components(separatedBy: "private static let vocabulary = \"\"\"")[1].components(separatedBy: "\"\"\"")[0].split(whereSeparator: \.isWhitespace).map(String.init)
var listening: [String: Any] = [:]
for p in profiles {
    let planner = TypingPlanner(data: data, mode: .english, usable: usable(p.id))
    listening[p.id] = vocabulary.compactMap { word -> [String: Any]? in
        let g = planner.plan(word)
        guard !g.steps.isEmpty, g.steps.allSatisfy(Course.isAllowed) else { return nil }
        return ["text": word, "guide": guide(g, text: word), "skills": Set(g.steps.flatMap { Course.skills(of: $0, data: data, mode: .english) }).map(skill).sorted()]
    }
}
// Replay native engine scenarios rather than publishing hand-written expected translations.
func fixture(_ title: String, _ mode: SubMode, _ strokes: [(String, Bool, Bool)], engineData: EngineData = data, extraEntries: [[String: Any]] = []) -> [String: Any] {
    let engine = ChordEngine(data: engineData, subMode: mode)
    var buffer: [Character] = [], cursor = 0, rows: [[String: Any]] = []
    for (chord, joined, caps) in strokes {
        let k = layout.keySet(names: chord.components(separatedBy: "+"))!
        let r = try! engine.translate(k, join: joined, capsLock: caps)
        for a in r.actions {
            switch a {
            case .insert(let s): let c = Array(s); buffer.insert(contentsOf: c, at: cursor); cursor += c.count
            case .deleteBackward(let n): let count = min(n, cursor); buffer.removeSubrange((cursor - count)..<cursor); cursor -= count
            case .deleteForward(let n): buffer.removeSubrange(cursor..<min(buffer.count, cursor + n))
            case .moveLeft(let n): cursor = max(0, cursor - n)
            case .moveRight(let n): cursor = min(buffer.count, cursor + n)
            }
        }
        rows.append(["keys": names(k), "join": joined, "capsLock": caps, "actions": r.actions.map(action),
            "signal": r.signal.map { String(describing: $0) } as Any? ?? NSNull(), "modeSwitched": r.modeSwitched,
            "subMode": engine.subMode.rawValue, "undoDepth": engine.undoDepth,
            "context": context(engine.currentContext), "text": String(buffer), "cursor": cursor])
    }
    return ["name": title, "mode": mode.rawValue, "strokes": rows, "extraEntries": extraEntries]
}
var accentedData = data
let accentSources = ["Quote+U = \"e\u{301}\" word", "Quote+Y = \"👩🏽‍💻\" word", "Grave+S+Quote = \"ß\" word"].joined(separator: "\n")
accentedData.english = DictionaryParser.parse(DefaultData.english + "\n" + accentSources, file: "english.dict", layout: layout, rolloverLimit: 6).0!
let accentRows = entries(accentedData.english).filter { row in !entries(data.english).contains { ($0["keys"] as! [String]) == (row["keys"] as! [String]) } }
var expandedSnippetData = data
expandedSnippetData.cpp = DictionaryParser.parse(DefaultData.cpp + "\nQuote+U = \"a|ß\" word", file: "cpp.dict", layout: layout, rolloverLimit: 6).0!
let expandedRows = entries(expandedSnippetData.cpp).filter { row in !entries(data.cpp).contains { ($0["keys"] as! [String]) == (row["keys"] as! [String]) } }
var whitespaceData = data
whitespaceData.english = DictionaryParser.parse(DefaultData.english + "\nQuote+U = \"hello \" word\nQuote+Y = \" world\" word", file: "english.dict", layout: layout, rolloverLimit: 6).0!
let whitespaceRows = entries(whitespaceData.english).filter { row in !entries(data.english).contains { ($0["keys"] as! [String]) == (row["keys"] as! [String]) } }
let fixtures: [[String: Any]] = [
    fixture("spaces, sentence capitals, capitalization undo", .english, [("S+C+J",false,false),("Period",false,false),("E+C+J",false,false),("Backslash",false,false),("Backslash",false,false),("N+M",false,false),("Backslash",false,false),("S+C+J+Space",false,false)]),
    fixture("silent e and real suffix undo", .english, [("F+G+C+K+Slash",false,false),("K+L",false,false),("Backslash",false,false),("O",false,false),("Backslash",false,false)]),
    fixture("digits and fingerspelling", .english, [("1+2+0",false,false),("Quote+S",false,false),("Quote+C",false,false),("Quote+Semicolon+S",false,false),("Space",false,false),("0",false,false),("Backslash",false,false)]),
    fixture("identifier casing commands and undo", .cpp, [("Grave+S",false,false),("F+G+C+Slash",false,false),("S+C+J",false,false),("2",false,false),("Backslash",false,false),("Grave",false,false),("Grave+C",false,false),("F+G+C+Slash",false,false),("S+C+J",false,false),("Grave+P",false,false),("F+G+C+Slash",false,false),("Grave+A",false,false),("S+C+J",false,false),("Semicolon",false,false)]),
    fixture("nested snippets, cursor exits, reverse actions", .cpp, [("Quote+I+F",false,false),("Quote",false,false),("S+C+J",false,false),("RBracket+Backslash",false,false),("RBracket+Backslash",false,false),("Backslash",false,false),("Backslash",false,false),("Backslash",false,false),("Backslash",false,false)]),
    fixture("mode switch, Caps Lock and joins", .english, [("S+C+J",false,true),("T+C+K",true,false),("LBracket+RBracket",false,false),("Quote+I+N",false,false),("Equal",false,false),("1",false,false),("LBracket+RBracket",false,false),("Period",false,false)]),
    fixture("extended graphemes, accented words, expanding capitals and undo", .english, [("Quote+U",false,false),("Quote+Y",false,false),("Backslash",false,false),("N+M",false,false),("Grave+S+Quote",false,false),("Backslash",false,false),("Grave+S+Quote",false,true),("Backslash",false,false)], engineData: accentedData, extraEntries: accentRows),
    fixture("Caps Lock expands a snippet cursor tail", .cpp, [("Quote+U",false,true),("S+C+J",false,false),("RBracket+Backslash",false,false),("Backslash",false,false),("Backslash",false,false),("Backslash",false,false)], engineData: expandedSnippetData, extraEntries: expandedRows),
    fixture("opening quote reused as closing quote, next-word spacing and Undo", .english, [("Quote+LBracket",false,false),("S+C+J",false,false),("Quote+LBracket",false,false),("E+C+J",false,false),("Backslash",false,false),("Backslash",false,false),("Quote+RBracket",false,false),("E+C+J",false,false)]),
    fixture("C++ chained calls, subscripts, template brackets and snippet exits", .cpp, [("S+C+J",false,false),("LBracket",false,false),("RBracket",false,false),("LBracket",false,false),("RBracket",false,false),("LBracket+P",false,false),("1",false,false),("RBracket+P",false,false),("Comma+LBracket",false,false),("S+C+J",false,false),("Period+RBracket",false,false),("LBracket",false,false),("RBracket",false,false),("Backslash",false,false)]),
    fixture("explicit spaces and leading/trailing whitespace avoid duplicate separators", .english, [("S+C+J",false,false),("Space",false,false),("E+C+J",false,false),("Quote+U",false,false),("S+C+J",false,false),("Quote+Y",false,false),("Backslash",false,false),("Backslash",false,false)], engineData: whitespaceData, extraEntries: whitespaceRows)
]
let parserInputs: [(name: String, file: DataFile, text: String, limit: Int)] = [
    ("unknown key", .english, "NotAKey = \"word\" word", 6),
    ("duplicate chord", .english, "S+C+J = \"sat\"\nJ+S+C = \"hat\"", 6),
    ("mixed Space chord", .english, "Space+S = \"s\"", 6),
    ("unknown command", .shared, "Backslash = disappear", 6),
    ("unknown escape", .english, "S = \"bad\\ntext\"", 6),
    ("two cursor markers", .cpp, "Quote+U = \"a|b|c\"", 6),
    ("suffix with cursor", .english, "Quote+U = \"i|ng\" suffix", 6),
    ("multiple kinds", .english, "S = \"word\" word symbol", 6),
    ("unknown flag", .english, "S = \"word\" magical", 6),
    ("reserved modifier", .layout, DefaultData.layout + "\n[keys]\nBad 56 onset", 6),
    ("duplicate key code", .layout, DefaultData.layout + "\n[keys]\nBad 0 onset", 6),
    ("wrong bank", .layout, DefaultData.layout + "\n[onset]\nM = \"m\"", 6),
    ("layout rollover", .layout, DefaultData.layout, 3),
    ("valid accented entry", .english, "Quote+U = \"é\" word", 6),
    ("valid literal pipe", .cpp, "Quote+U = \"\\|\" symbol", 6),
]
let parserFixtures: [[String: Any]] = parserInputs.map { input in
    let accepted: Bool, problems: [LoadProblem]
    switch input.file {
    case .layout: let parsed = LayoutParser.parse(input.text, file: input.file.fileName, rolloverLimit: input.limit); accepted = parsed.0 != nil; problems = parsed.1
    case .orthography: let parsed = OrthographyParser.parse(input.text, file: input.file.fileName); accepted = parsed.0 != nil; problems = parsed.1
    default: let parsed = DictionaryParser.parse(input.text, file: input.file.fileName, layout: layout, rolloverLimit: input.limit); accepted = parsed.0 != nil; problems = parsed.1
    }
    return ["name": input.name, "file": input.file.rawValue, "source": input.text, "rolloverLimit": input.limit, "accepted": accepted, "messages": problems.map(\.message)]
}
let customTexts = ["making tried biggest happy happily boxes running dying said cities", "Hello. hello again! Lowercase after punctuation.", "The window is open. Take the window seat.", "Mr. and Mrs. Smith said: \"Yes.\"", "int max_size = MAX_VALUE;", "123 321 2026 1029384756", "Café 👨‍👩‍👧‍👦 e\u{301} ß αβγ", "  sat   hat\t\n    tan", "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz"]
let customPlannerFixtures: [[String: Any]] = customTexts.map { text in
    let mode: SubMode = text.hasPrefix("int") ? .cpp : .english
    return ["text": text, "mode": mode.rawValue, "guide": guide(TypingPlanner(data: data, mode: mode, usable: usable("macbook-ansi")).plan(text), text: text)]
}
func wordMetrics(_ m: WordPracticeMetrics) -> [String: Any] {
    ["elapsed": m.elapsed, "wpm": m.wpm, "rawWPM": m.rawWPM, "accuracy": m.accuracy,
     "consistency": m.consistency, "correct": m.correct, "incorrect": m.incorrect, "extra": m.extra,
     "missed": m.missed, "completedWords": m.completedWords, "correctWords": m.correctWords, "mistakes": m.mistakes]
}
func wordFixture(_ name: String, goal: WordPracticeGoal, operations: (WordPracticeSession) -> [[String: Any]]) -> [String: Any] {
    let session = WordPracticeSession(goal: goal, seed: 42, words: ["sat", "hat", "making"])
    let initialTargets = session.targetWords
    let ops = operations(session)
    var snapshots: [[String: Any]] = []
    for op in ops {
        let now = op["at"] as! Double
        var accepted: Any = NSNull()
        if let range = op["range"] as? [Int] {
            accepted = session.edit(range: range[0]..<range[1], replacement: op["text"] as! String,
                                    at: now, verifiedChordPreview: op["verified"] as? Bool ?? false)
        } else { session.advance(to: now) }
        snapshots.append(["accepted": accepted, "typedText": session.typedText,
            "startedAt": session.startedAt as Any? ?? NSNull(), "finishedAt": session.finishedAt as Any? ?? NSNull(),
            "metrics": wordMetrics(session.metrics(at: now)),
            "samples": session.samples.map { ["seconds": $0.seconds, "wpm": $0.wpm, "rawWPM": $0.rawWPM, "errors": $0.errors] as [String: Any] }])
    }
    let goalType: String, count: Int
    switch goal { case .time(let n): goalType = "time"; count = n; case .words(let n): goalType = "words"; count = n }
    return ["name": name, "seed": "42", "words": ["sat", "hat", "making"], "goal": ["type": goalType, "count": count],
            "targetWords": initialTargets, "operations": ops, "snapshots": snapshots]
}
let wordFixtures: [[String: Any]] = [
    wordFixture("finish the final word without a trailing space", goal: .words(3)) { s in
        [["range": [0, 0], "text": s.targetWords[0] + " ", "at": 10.0],
         ["range": [s.targetWords[0].count + 1, s.targetWords[0].count + 1], "text": s.targetWords[1] + " " + s.targetWords[2], "at": 12.5],
         ["range": [0, 0], "text": "x", "at": 20.0]]
    },
    wordFixture("corrected mistakes retain accuracy cost", goal: .words(3)) { s in
        [["range": [0, 0], "text": "x", "at": 10.0], ["range": [0, 1], "text": "", "at": 10.5],
         ["range": [0, 0], "text": s.targetWords.joined(separator: " "), "at": 12.0]]
    },
    wordFixture("time counts idle and focus interruptions", goal: .time(2)) { s in
        [["at": 9.0], ["range": [0, 0], "text": s.targetWords[0], "at": 10.0], ["at": 11.25], ["at": 100.0],
         ["range": [0, 0], "text": "x", "at": 101.0]]
    },
    wordFixture("skipped words, extras and missing letters", goal: .words(3)) { s in
        [["range": [0, 0], "text": "x  " + s.targetWords[2] + "extra ", "at": 10.0]]
    },
    wordFixture("verified intermediate chord does not count as a mistake", goal: .words(3)) { _ in
        [["range": [0, 0], "text": "make", "verified": true, "at": 10.0],
         ["range": [3, 4], "text": "ing", "verified": true, "at": 11.0]]
    },
    wordFixture("reject newlines and invalid ranges", goal: .words(3)) { _ in
        [["range": [0, 0], "text": "\n", "at": 10.0], ["range": [1, 1], "text": "sat", "at": 11.0],
         ["range": [0, 0], "text": "sat", "at": 12.0], ["at": 11.0], ["at": 13.9999999999]]
    }
]
func customRecord(_ chord: CustomChord) -> [String: Any] {
    ["id": chord.id, "keyCodes": chord.keyCodes.map(Int.init), "text": chord.text, "scope": chord.scope.rawValue,
     "spacing": chord.spacing.rawValue, "isEnabled": chord.isEnabled]
}
func custom(_ id: String, _ keyNames: [String], _ text: String = "hello", scope: CustomChordScope = .english,
            spacing: CustomChordSpacing = .words, enabled: Bool = true) -> CustomChord {
    CustomChord(id: id, keyCodes: keyNames.map { layout.keys[layout.indexByName[$0]!].code }, text: text,
                scope: scope, spacing: spacing, isEnabled: enabled)
}
let firstCustom = custom("existing", ["S", "C", "J"])
let issueCases: [(CustomChord, [CustomChord], Bool)] = [
    (custom("", ["S"]), [], false), (custom("new", []), [], false),
    (CustomChord(id: "new", keyCodes: [65535], text: "hello"), [], false),
    (custom("new", ["Space"]), [], false), (custom("new", ["S"], " \n"), [], false),
    (custom("new", ["Backslash"]), [], false), (custom("new", ["S", "C", "J"]), [firstCustom], false),
    (custom("new", ["S", "C", "J"], enabled: false), [firstCustom], false),
    (custom("new", ["S", "C", "J"], scope: .cpp), [firstCustom], false),
    (custom("new", ["S", "C"]), [], true)
]
let customIssueFixtures: [[String: Any]] = issueCases.map { chord, others, blocked in
    ["chord": customRecord(chord), "others": others.map(customRecord), "blocked": blocked,
     "message": CustomChords.issue(for: chord, among: others, base: data, usable: { _ in !blocked })?.message as Any? ?? NSNull()]
}
let appliedCustoms = [custom("phrase", ["S", "C", "J"], "hello world", scope: .both),
                      custom("symbol", ["Quote", "U"], "→", scope: .both, spacing: .exact)]
let customizedData = CustomChords.applying(appliedCustoms, to: data)
let customReplayFixtures = SubMode.allCases.map { mode in
    fixture("custom words, attached symbols, caps and undo", mode,
            [("S+C+J", false, false), ("Quote+U", false, false), ("S+C+J", false, true), ("Backslash", false, false), ("Backslash", false, false)],
            engineData: customizedData,
            extraEntries: entries(customizedData.dictionary(for: mode)).filter { row in
                (row["keys"] as! [String]) == names(appliedCustoms[0].keys(in: layout)!) ||
                (row["keys"] as! [String]) == names(appliedCustoms[1].keys(in: layout)!)
            })
}
let customSuggestions = CustomChordScope.allCases.map { scope -> [String: Any] in
    ["scope": scope.rawValue, "keys": CustomChords.suggestions(scope: scope, among: [], base: data, geometry: .ansi).map(names)]
}
let exported: [String: Any] = [
    "schemaVersion": 1, "mappingVersion": "native-core-v1", "source": "KeyChordCore Swift public module",
    "sources": Dictionary(uniqueKeysWithValues: DataFile.allCases.map { ($0.rawValue, $0.defaultSource) }),
    "layout": ["keys": layout.keys.enumerated().map { i, k -> [String: Any] in
        let role: String, digit: Any
        switch k.role { case .bank(let b): role = b.rawValue; digit = NSNull()
        case .number(let d): role = "number"; digit = String(d)
        case .spell: role = "spell"; digit = NSNull()
        case .space: role = "space"; digit = NSNull() }
        return ["index": i, "name": k.name, "code": Int(k.code), "role": role, "digit": digit, "browserCode": browserCode(k),
                "legends": ["ansi": KeyboardGeometry.ansi.label(for: k.code), "iso": KeyboardGeometry.iso.label(for: k.code)]]
    }, "clusters": Dictionary(uniqueKeysWithValues: Bank.allCases.map { b in
        (b.rawValue, (layout.clusters[b] ?? [:]).sorted { $0.key.bits < $1.key.bits }.map { ["keys": names($0.key), "text": $0.value] })
    }), "fingerspelling": layout.fingerspelling.sorted { $0.key.bits < $1.key.bits }.map { ["keys": names($0.key), "text": $0.value] }],
    "dictionaries": ["shared": entries(data.shared), "english": entries(data.english), "cpp": entries(data.cpp)],
    "orthographyExceptions": data.orthographyExceptions,
    "meanings": ["english": meaning(.english), "cpp": meaning(.cpp)],
    "geometry": ["ansi": geometry(.ansi), "iso": geometry(.iso)],
    "profiles": profiles.map { p -> [String: Any] in ["id": p.id, "label": p.label, "rolloverLimit": 6, "wiring": p.wiring.map(wiring) ?? NSNull()] },
    "course": ["curriculumVersion": Course.curriculumVersion, "units": Course.units.map { ["title": $0.title, "stepIDs": $0.steps.map(\.id)] },
               "steps": courseSteps, "legacyLessonExpansions": Course.legacyLessonExpansions.mapValues { $0.sorted() }],
    "topics": topics, "listening": listening, "listeningVocabulary": vocabulary,
    "reference": ["text": LayoutReference.render(layout), "manualHTML": Manual.html(data: data)],
    "parityFixtures": fixtures, "parserFixtures": parserFixtures, "customPlannerFixtures": customPlannerFixtures,
    "wordPractice": ["vocabularies": WordPracticeVocabulary.allCases.map { ["id": $0.rawValue, "title": $0.title, "words": $0.words] as [String: Any] },
                     "times": [15, 30, 60, 120], "counts": [10, 25, 50, 100]],
    "wordPracticeFixtures": wordFixtures,
    "customChordFixtures": ["issues": customIssueFixtures, "chords": appliedCustoms.map(customRecord), "replays": customReplayFixtures, "suggestions": customSuggestions]
]
let json = try JSONSerialization.data(withJSONObject: exported, options: [.sortedKeys, .withoutEscapingSlashes])
try json.write(to: URL(fileURLWithPath: outputPath), options: .atomic)
FileHandle.standardError.write(Data("Saved \(json.count) bytes to \(outputPath)\n".utf8))
