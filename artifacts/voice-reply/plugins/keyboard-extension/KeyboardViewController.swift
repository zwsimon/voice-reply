import UIKit
import AVFoundation

// MARK: - State

enum VRState: Equatable {
    case idle
    case recording
    case processing
    case result(String)
    case error(String)

    static func == (lhs: VRState, rhs: VRState) -> Bool {
        switch (lhs, rhs) {
        case (.idle, .idle), (.recording, .recording), (.processing, .processing): return true
        case (.result(let a), .result(let b)): return a == b
        case (.error(let a), .error(let b)): return a == b
        default: return false
        }
    }
}

// MARK: - KeyboardViewController

class KeyboardViewController: UIInputViewController {

    // MARK: State & Data

    private var vrState: VRState = .idle {
        didSet { if oldValue != vrState { updateUI() } }
    }
    private var tone: String = "friendly"
    private var audioRecorder: AVAudioRecorder?
    private var recordingURL: URL?

    private var apiBase: String {
        Bundle(for: type(of: self))
            .object(forInfoDictionaryKey: "VRApiBase") as? String
            ?? ""
    }

    // MARK: UI

    private lazy var headerView: UIView = {
        let v = UIView()
        v.translatesAutoresizingMaskIntoConstraints = false
        return v
    }()

    private lazy var dotView: UIView = {
        let v = UIView()
        v.translatesAutoresizingMaskIntoConstraints = false
        v.layer.cornerRadius = 4
        v.backgroundColor = UIColor(red: 0.107, green: 0.518, blue: 1.0, alpha: 1.0)
        return v
    }()

    private lazy var titleLabel: UILabel = {
        let l = UILabel()
        l.translatesAutoresizingMaskIntoConstraints = false
        l.text = "VoiceReply"
        l.font = UIFont.systemFont(ofSize: 15, weight: .semibold)
        l.textColor = .label
        return l
    }()

    private lazy var toneControl: UISegmentedControl = {
        let s = UISegmentedControl(items: ["Friendly", "Formal", "Casual"])
        s.translatesAutoresizingMaskIntoConstraints = false
        s.selectedSegmentIndex = 0
        s.setTitleTextAttributes(
            [.font: UIFont.systemFont(ofSize: 11, weight: .medium)], for: .normal)
        s.addTarget(self, action: #selector(toneChanged), for: .valueChanged)
        return s
    }()

    private lazy var contentArea: UIView = {
        let v = UIView()
        v.translatesAutoresizingMaskIntoConstraints = false
        return v
    }()

    private lazy var micButton: UIButton = {
        let b = UIButton(type: .system)
        b.translatesAutoresizingMaskIntoConstraints = false
        b.layer.cornerRadius = 34
        b.clipsToBounds = true
        b.backgroundColor = UIColor(red: 0.107, green: 0.518, blue: 1.0, alpha: 1.0)
        let cfg = UIImage.SymbolConfiguration(pointSize: 26, weight: .medium)
        b.setImage(UIImage(systemName: "mic.fill", withConfiguration: cfg), for: .normal)
        b.tintColor = .white
        b.addTarget(self, action: #selector(micTapped), for: .touchUpInside)
        return b
    }()

    private lazy var hintLabel: UILabel = {
        let l = UILabel()
        l.translatesAutoresizingMaskIntoConstraints = false
        l.text = "Tap to speak your reply"
        l.font = UIFont.systemFont(ofSize: 13)
        l.textColor = .secondaryLabel
        l.textAlignment = .center
        return l
    }()

    private lazy var activityIndicator: UIActivityIndicatorView = {
        let a = UIActivityIndicatorView(style: .medium)
        a.translatesAutoresizingMaskIntoConstraints = false
        a.hidesWhenStopped = true
        return a
    }()

    private lazy var processingLabel: UILabel = {
        let l = UILabel()
        l.translatesAutoresizingMaskIntoConstraints = false
        l.text = "Generating reply…"
        l.font = UIFont.systemFont(ofSize: 13)
        l.textColor = .secondaryLabel
        l.textAlignment = .center
        l.isHidden = true
        return l
    }()

    private lazy var resultCard: UIView = {
        let v = UIView()
        v.translatesAutoresizingMaskIntoConstraints = false
        v.layer.cornerRadius = 12
        v.backgroundColor = UIColor(red: 0.107, green: 0.518, blue: 1.0, alpha: 0.08)
        v.layer.borderWidth = 1
        v.layer.borderColor = UIColor(
            red: 0.107, green: 0.518, blue: 1.0, alpha: 0.3).cgColor
        v.isHidden = true
        return v
    }()

    private lazy var resultLabel: UILabel = {
        let l = UILabel()
        l.translatesAutoresizingMaskIntoConstraints = false
        l.numberOfLines = 3
        l.font = UIFont.systemFont(ofSize: 14)
        l.textColor = .label
        return l
    }()

    private lazy var insertButton: UIButton = {
        let b = UIButton(type: .system)
        b.translatesAutoresizingMaskIntoConstraints = false
        b.layer.cornerRadius = 17
        b.backgroundColor = UIColor(red: 0.107, green: 0.518, blue: 1.0, alpha: 1.0)
        b.setTitle("Insert Reply", for: .normal)
        b.setTitleColor(.white, for: .normal)
        b.titleLabel?.font = UIFont.systemFont(ofSize: 14, weight: .semibold)
        b.contentEdgeInsets = UIEdgeInsets(top: 0, left: 16, bottom: 0, right: 16)
        b.addTarget(self, action: #selector(insertTapped), for: .touchUpInside)
        b.isHidden = true
        return b
    }()

    private lazy var retryButton: UIButton = {
        let b = UIButton(type: .system)
        b.translatesAutoresizingMaskIntoConstraints = false
        b.layer.cornerRadius = 17
        b.backgroundColor = UIColor.secondarySystemBackground
        let cfg = UIImage.SymbolConfiguration(pointSize: 15, weight: .medium)
        b.setImage(UIImage(systemName: "arrow.counterclockwise", withConfiguration: cfg), for: .normal)
        b.tintColor = .secondaryLabel
        b.contentEdgeInsets = UIEdgeInsets(top: 0, left: 12, bottom: 0, right: 12)
        b.addTarget(self, action: #selector(retryTapped), for: .touchUpInside)
        b.isHidden = true
        return b
    }()

    private lazy var errorLabel: UILabel = {
        let l = UILabel()
        l.translatesAutoresizingMaskIntoConstraints = false
        l.font = UIFont.systemFont(ofSize: 12)
        l.textColor = .systemRed
        l.textAlignment = .center
        l.numberOfLines = 3
        l.isHidden = true
        return l
    }()

    // Bottom bar
    private lazy var bottomBar: UIView = {
        let v = UIView()
        v.translatesAutoresizingMaskIntoConstraints = false
        v.backgroundColor = UIColor.systemGroupedBackground
        return v
    }()

    private lazy var separator: UIView = {
        let v = UIView()
        v.translatesAutoresizingMaskIntoConstraints = false
        v.backgroundColor = UIColor.separator
        return v
    }()

    private lazy var switchKeyboardButton: UIButton = {
        let b = UIButton(type: .system)
        b.translatesAutoresizingMaskIntoConstraints = false
        let cfg = UIImage.SymbolConfiguration(pointSize: 20, weight: .light)
        b.setImage(UIImage(systemName: "globe", withConfiguration: cfg), for: .normal)
        b.tintColor = .label
        b.addTarget(self, action: #selector(switchKeyboard), for: .touchUpInside)
        return b
    }()

    private lazy var spaceButton: UIButton = {
        let b = makeKeyButton(title: "space")
        b.addTarget(self, action: #selector(spaceTapped), for: .touchUpInside)
        return b
    }()

    private lazy var returnButton: UIButton = {
        let b = makeKeyButton(title: "return")
        b.addTarget(self, action: #selector(returnTapped), for: .touchUpInside)
        return b
    }()

    private func makeKeyButton(title: String) -> UIButton {
        let b = UIButton(type: .system)
        b.translatesAutoresizingMaskIntoConstraints = false
        b.setTitle(title, for: .normal)
        b.setTitleColor(.label, for: .normal)
        b.titleLabel?.font = UIFont.systemFont(ofSize: 15)
        b.backgroundColor = .systemBackground
        b.layer.cornerRadius = 6
        b.layer.shadowColor = UIColor.black.cgColor
        b.layer.shadowOffset = CGSize(width: 0, height: 1)
        b.layer.shadowOpacity = 0.3
        b.layer.shadowRadius = 0
        return b
    }

    // MARK: Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        setupUI()
        updateUI()
    }

    // MARK: Setup

    private func setupUI() {
        view.backgroundColor = UIColor.systemGroupedBackground

        view.addSubview(headerView)
        view.addSubview(contentArea)
        view.addSubview(bottomBar)

        headerView.addSubview(dotView)
        headerView.addSubview(titleLabel)
        headerView.addSubview(toneControl)

        contentArea.addSubview(micButton)
        contentArea.addSubview(hintLabel)
        contentArea.addSubview(activityIndicator)
        contentArea.addSubview(processingLabel)
        contentArea.addSubview(resultCard)
        resultCard.addSubview(resultLabel)
        contentArea.addSubview(insertButton)
        contentArea.addSubview(retryButton)
        contentArea.addSubview(errorLabel)

        bottomBar.addSubview(separator)
        bottomBar.addSubview(switchKeyboardButton)
        bottomBar.addSubview(spaceButton)
        bottomBar.addSubview(returnButton)

        setupConstraints()
    }

    private func setupConstraints() {
        let contentH: CGFloat = 160

        NSLayoutConstraint.activate([
            // Header
            headerView.topAnchor.constraint(equalTo: view.topAnchor, constant: 10),
            headerView.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 14),
            headerView.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -14),
            headerView.heightAnchor.constraint(equalToConstant: 34),

            dotView.widthAnchor.constraint(equalToConstant: 8),
            dotView.heightAnchor.constraint(equalToConstant: 8),
            dotView.centerYAnchor.constraint(equalTo: headerView.centerYAnchor),
            dotView.leadingAnchor.constraint(equalTo: headerView.leadingAnchor),

            titleLabel.leadingAnchor.constraint(equalTo: dotView.trailingAnchor, constant: 6),
            titleLabel.centerYAnchor.constraint(equalTo: headerView.centerYAnchor),

            toneControl.trailingAnchor.constraint(equalTo: headerView.trailingAnchor),
            toneControl.centerYAnchor.constraint(equalTo: headerView.centerYAnchor),
            toneControl.widthAnchor.constraint(equalToConstant: 210),

            // Content area
            contentArea.topAnchor.constraint(equalTo: headerView.bottomAnchor, constant: 4),
            contentArea.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            contentArea.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            contentArea.heightAnchor.constraint(equalToConstant: contentH),

            // Mic button (centered)
            micButton.centerXAnchor.constraint(equalTo: contentArea.centerXAnchor),
            micButton.centerYAnchor.constraint(equalTo: contentArea.centerYAnchor, constant: -10),
            micButton.widthAnchor.constraint(equalToConstant: 68),
            micButton.heightAnchor.constraint(equalToConstant: 68),

            hintLabel.topAnchor.constraint(equalTo: micButton.bottomAnchor, constant: 8),
            hintLabel.centerXAnchor.constraint(equalTo: contentArea.centerXAnchor),
            hintLabel.leadingAnchor.constraint(equalTo: contentArea.leadingAnchor, constant: 16),
            hintLabel.trailingAnchor.constraint(equalTo: contentArea.trailingAnchor, constant: -16),

            // Processing
            activityIndicator.centerXAnchor.constraint(equalTo: contentArea.centerXAnchor),
            activityIndicator.centerYAnchor.constraint(equalTo: contentArea.centerYAnchor, constant: -10),

            processingLabel.topAnchor.constraint(equalTo: activityIndicator.bottomAnchor, constant: 8),
            processingLabel.centerXAnchor.constraint(equalTo: contentArea.centerXAnchor),

            // Result card
            resultCard.topAnchor.constraint(equalTo: contentArea.topAnchor, constant: 8),
            resultCard.leadingAnchor.constraint(equalTo: contentArea.leadingAnchor, constant: 12),
            resultCard.trailingAnchor.constraint(equalTo: contentArea.trailingAnchor, constant: -12),

            resultLabel.topAnchor.constraint(equalTo: resultCard.topAnchor, constant: 10),
            resultLabel.leadingAnchor.constraint(equalTo: resultCard.leadingAnchor, constant: 12),
            resultLabel.trailingAnchor.constraint(equalTo: resultCard.trailingAnchor, constant: -12),
            resultLabel.bottomAnchor.constraint(equalTo: resultCard.bottomAnchor, constant: -10),

            // Insert + retry
            insertButton.topAnchor.constraint(equalTo: resultCard.bottomAnchor, constant: 8),
            insertButton.leadingAnchor.constraint(equalTo: contentArea.leadingAnchor, constant: 12),
            insertButton.heightAnchor.constraint(equalToConstant: 34),

            retryButton.topAnchor.constraint(equalTo: resultCard.bottomAnchor, constant: 8),
            retryButton.leadingAnchor.constraint(equalTo: insertButton.trailingAnchor, constant: 8),
            retryButton.heightAnchor.constraint(equalToConstant: 34),
            retryButton.widthAnchor.constraint(equalToConstant: 44),

            // Error
            errorLabel.centerXAnchor.constraint(equalTo: contentArea.centerXAnchor),
            errorLabel.centerYAnchor.constraint(equalTo: contentArea.centerYAnchor),
            errorLabel.leadingAnchor.constraint(equalTo: contentArea.leadingAnchor, constant: 20),
            errorLabel.trailingAnchor.constraint(equalTo: contentArea.trailingAnchor, constant: -20),

            // Bottom bar
            bottomBar.topAnchor.constraint(equalTo: contentArea.bottomAnchor),
            bottomBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bottomBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            bottomBar.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            bottomBar.heightAnchor.constraint(equalToConstant: 44),

            separator.topAnchor.constraint(equalTo: bottomBar.topAnchor),
            separator.leadingAnchor.constraint(equalTo: bottomBar.leadingAnchor),
            separator.trailingAnchor.constraint(equalTo: bottomBar.trailingAnchor),
            separator.heightAnchor.constraint(equalToConstant: 0.5),

            switchKeyboardButton.leadingAnchor.constraint(equalTo: bottomBar.leadingAnchor, constant: 10),
            switchKeyboardButton.centerYAnchor.constraint(equalTo: bottomBar.centerYAnchor),
            switchKeyboardButton.widthAnchor.constraint(equalToConstant: 44),
            switchKeyboardButton.heightAnchor.constraint(equalToConstant: 44),

            spaceButton.centerXAnchor.constraint(equalTo: bottomBar.centerXAnchor),
            spaceButton.centerYAnchor.constraint(equalTo: bottomBar.centerYAnchor),
            spaceButton.widthAnchor.constraint(equalToConstant: 170),
            spaceButton.heightAnchor.constraint(equalToConstant: 40),

            returnButton.trailingAnchor.constraint(equalTo: bottomBar.trailingAnchor, constant: -10),
            returnButton.centerYAnchor.constraint(equalTo: bottomBar.centerYAnchor),
            returnButton.widthAnchor.constraint(equalToConstant: 88),
            returnButton.heightAnchor.constraint(equalToConstant: 40),
        ])
    }

    // MARK: UI Updates

    private func updateUI() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }

            let blue = UIColor(red: 0.107, green: 0.518, blue: 1.0, alpha: 1.0)

            // Reset all to hidden
            self.micButton.isHidden = true
            self.hintLabel.isHidden = true
            self.activityIndicator.stopAnimating()
            self.processingLabel.isHidden = true
            self.resultCard.isHidden = true
            self.insertButton.isHidden = true
            self.retryButton.isHidden = true
            self.errorLabel.isHidden = true

            switch self.vrState {
            case .idle:
                self.titleLabel.text = "VoiceReply"
                self.dotView.backgroundColor = blue
                let cfg = UIImage.SymbolConfiguration(pointSize: 26, weight: .medium)
                self.micButton.setImage(UIImage(systemName: "mic.fill", withConfiguration: cfg), for: .normal)
                self.micButton.backgroundColor = blue
                self.micButton.isHidden = false
                self.hintLabel.text = "Tap to speak your reply"
                self.hintLabel.textColor = .secondaryLabel
                self.hintLabel.isHidden = false

            case .recording:
                self.titleLabel.text = "Listening…"
                self.dotView.backgroundColor = .systemRed
                let cfg = UIImage.SymbolConfiguration(pointSize: 26, weight: .medium)
                self.micButton.setImage(UIImage(systemName: "stop.fill", withConfiguration: cfg), for: .normal)
                self.micButton.backgroundColor = .systemRed
                self.micButton.isHidden = false
                self.hintLabel.text = "Tap to stop"
                self.hintLabel.textColor = .systemRed
                self.hintLabel.isHidden = false

            case .processing:
                self.titleLabel.text = "Generating…"
                self.dotView.backgroundColor = .systemOrange
                self.activityIndicator.startAnimating()
                self.processingLabel.isHidden = false

            case .result(let text):
                self.titleLabel.text = "Your reply"
                self.dotView.backgroundColor = .systemGreen
                self.resultLabel.text = text
                self.resultCard.isHidden = false
                self.insertButton.isHidden = false
                self.retryButton.isHidden = false

            case .error(let msg):
                self.titleLabel.text = "VoiceReply"
                self.dotView.backgroundColor = .systemRed
                let cfg = UIImage.SymbolConfiguration(pointSize: 26, weight: .medium)
                self.micButton.setImage(UIImage(systemName: "mic.fill", withConfiguration: cfg), for: .normal)
                self.micButton.backgroundColor = blue
                self.micButton.isHidden = false
                self.errorLabel.text = msg
                self.errorLabel.isHidden = false
            }
        }
    }

    // MARK: Actions

    @objc private func toneChanged() {
        let tones = ["friendly", "formal", "casual"]
        if toneControl.selectedSegmentIndex < tones.count {
            tone = tones[toneControl.selectedSegmentIndex]
        }
    }

    @objc private func micTapped() {
        switch vrState {
        case .idle, .error: startRecording()
        case .recording:    stopRecording()
        default: break
        }
    }

    @objc private func insertTapped() {
        guard case .result(let text) = vrState else { return }
        textDocumentProxy.insertText(text)
        vrState = .idle
    }

    @objc private func retryTapped() { vrState = .idle }

    @objc private func switchKeyboard() { advanceToNextInputMode() }
    @objc private func spaceTapped()    { textDocumentProxy.insertText(" ") }
    @objc private func returnTapped()   { textDocumentProxy.insertText("\n") }

    // MARK: Recording

    private func startRecording() {
        AVAudioSession.sharedInstance().requestRecordPermission { [weak self] granted in
            DispatchQueue.main.async {
                guard let self = self else { return }
                guard granted else {
                    self.vrState = .error("Microphone denied.\nGo to Settings → VoiceReply → Microphone.")
                    return
                }
                do {
                    let session = AVAudioSession.sharedInstance()
                    try session.setCategory(.record, mode: .default)
                    try session.setActive(true)

                    let url = FileManager.default.temporaryDirectory
                        .appendingPathComponent("vr_rec.m4a")
                    let settings: [String: Any] = [
                        AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
                        AVSampleRateKey: 44100,
                        AVNumberOfChannelsKey: 1,
                        AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
                    ]
                    self.recordingURL = url
                    self.audioRecorder = try AVAudioRecorder(url: url, settings: settings)
                    self.audioRecorder?.record()
                    self.vrState = .recording
                } catch {
                    self.vrState = .error("Recording failed:\n\(error.localizedDescription)")
                }
            }
        }
    }

    private func stopRecording() {
        audioRecorder?.stop()
        audioRecorder = nil
        try? AVAudioSession.sharedInstance().setActive(false)
        vrState = .processing
        guard let url = recordingURL else {
            vrState = .error("No recording found.")
            return
        }
        processAudio(at: url)
    }

    // MARK: API

    private func processAudio(at url: URL) {
        guard let audioData = try? Data(contentsOf: url) else {
            vrState = .error("Could not read recording.")
            return
        }
        let base64 = audioData.base64EncodedString()

        transcribe(base64: base64) { [weak self] result in
            switch result {
            case .success(let transcript):
                self?.generateReply(transcript: transcript) { replyResult in
                    switch replyResult {
                    case .success(let reply): self?.vrState = .result(reply)
                    case .failure(let e):     self?.vrState = .error("Reply failed:\n\(e.localizedDescription)")
                    }
                }
            case .failure(let e):
                self?.vrState = .error("Transcription failed:\n\(e.localizedDescription)")
            }
        }
    }

    private func transcribe(base64: String, completion: @escaping (Result<String, Error>) -> Void) {
        request(
            path: "/voicereply/transcribe",
            body: ["audio": base64, "format": "m4a"]
        ) { result in
            switch result {
            case .success(let json):
                if let t = json["transcript"] as? String { completion(.success(t)) }
                else { completion(.failure(VRError("No transcript in response"))) }
            case .failure(let e): completion(.failure(e))
            }
        }
    }

    private func generateReply(transcript: String, completion: @escaping (Result<String, Error>) -> Void) {
        request(
            path: "/voicereply/generate-reply",
            body: ["transcript": transcript, "tone": tone]
        ) { result in
            switch result {
            case .success(let json):
                if let r = json["reply"] as? String { completion(.success(r)) }
                else { completion(.failure(VRError("No reply in response"))) }
            case .failure(let e): completion(.failure(e))
            }
        }
    }

    private func request(
        path: String,
        body: [String: Any],
        completion: @escaping (Result<[String: Any], Error>) -> Void
    ) {
        guard !apiBase.isEmpty, let url = URL(string: apiBase + path) else {
            completion(.failure(VRError("API not configured. Set VRApiBase in Info.plist.")))
            return
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 30
        guard let data = try? JSONSerialization.data(withJSONObject: body) else {
            completion(.failure(VRError("Failed to encode request")))
            return
        }
        req.httpBody = data

        URLSession.shared.dataTask(with: req) { data, _, error in
            if let error = error { completion(.failure(error)); return }
            guard let data = data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else {
                completion(.failure(VRError("Invalid server response")))
                return
            }
            if let errMsg = json["error"] as? String {
                completion(.failure(VRError(errMsg)))
                return
            }
            completion(.success(json))
        }.resume()
    }
}

// MARK: - Helpers

struct VRError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}
