// --- 1. CẤU HÌNH API ĐĂNG NHẬP ---
const API_URL = "https://script.google.com/macros/s/AKfycbzEt5Quy07evC8GJZO77FnsHMelxRERJM1UeSg90FPGqAcsbKqvub6sHVXd3zj13drhyA/exec";

// --- 2. BIẾN TOÀN CỤC ---
let currentUser = null;
let pendingShareId = null; 
let pendingExamSave = null; 

let db = { users: [], folders: [], exams: [] };

function generateId() { return Math.random().toString(36).substr(2, 9); }

let currentFolderId = null;
let currentExamId = null;
let viewBeforeConfirm = 0;
let confirmAction = null;

let quizData = [];
let quizIndex = 0;
let quizMode = 'test';
let userAnswers = {};
let flaggedQs = new Set();
let practiceClicked = {};

// --- BỘ CÔNG CỤ CUSTOM MODAL ---
let cAlertCallback = null;
function customAlert(msg, title = "Thông báo", callback = null) {
    document.getElementById('cAlertTitle').innerText = title;
    document.getElementById('cAlertMsg').innerText = msg;
    cAlertCallback = callback;
    document.getElementById('customAlertModal').classList.remove('hidden');
}
function closeCustomAlert() {
    document.getElementById('customAlertModal').classList.add('hidden');
    if (cAlertCallback) cAlertCallback();
}

let cPromptCallback = null;
function customPrompt(msg, defaultVal = "", title = "Nhập thông tin", callback) {
    document.getElementById('cPromptTitle').innerText = title;
    document.getElementById('cPromptMsg').innerText = msg;
    let input = document.getElementById('cPromptInput');
    input.value = defaultVal;
    cPromptCallback = callback;
    document.getElementById('customPromptModal').classList.remove('hidden');
    setTimeout(() => input.focus(), 100);
    
    document.getElementById('btnCPromptOk').onclick = () => {
        document.getElementById('customPromptModal').classList.add('hidden');
        if (cPromptCallback) cPromptCallback(input.value);
    };
}
function closeCustomPrompt() {
    document.getElementById('customPromptModal').classList.add('hidden');
}

function customConfirmUI(msg, title, yesCallback) {
    document.getElementById('cConfirmTitle').innerText = title;
    document.getElementById('cConfirmMsg').innerText = msg;
    document.getElementById('customConfirmModal').classList.remove('hidden');
    document.getElementById('btnCConfirmYes').onclick = () => {
        document.getElementById('customConfirmModal').classList.add('hidden');
        yesCallback();
    }
}
function closeCustomConfirm() {
    document.getElementById('customConfirmModal').classList.add('hidden');
}

// --- CÁC HÀM ẨN/HIỆN SIDEBAR CHUẨN ---
function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('collapsed');
}
function toggleQuizNav() {
    document.getElementById('quizNavArea').classList.toggle('open');
}

// --- 3. KHỞI TẠO APP & ĐĂNG NHẬP ---
function init() {
    document.getElementById('impBody').addEventListener('keydown', handleSmartEditor);
    document.getElementById('impBody').addEventListener('input', updateLivePreview);

    document.getElementById('loginUser').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') executeLogin();
    });
    document.getElementById('loginPass').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') executeLogin();
    });

    let urlParams = new URLSearchParams(window.location.search);
    pendingShareId = urlParams.get('share');

    // Mặc định: Màn hình <= 1024px (iPad, Mobile) thì giấu Sidebar trái đi cho gọn
    if (window.innerWidth <= 1024) {
        document.getElementById('sidebar').classList.add('collapsed');
    }

    const savedUser = localStorage.getItem('tn_session');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        silentLoginAndLoadData(currentUser);
    } else {
        switchView(8); 
    }
}

function goToLogin(role) {
    document.getElementById('loginTitle').innerText = role === 'admin' ? "Đăng nhập Admin" : "Đăng nhập User";
    document.getElementById('loginUser').value = role === 'admin' ? 'admin' : '';
    document.getElementById('loginPass').value = '';
    document.getElementById('loginError').innerText = '';
    switchView(6);
    
    setTimeout(() => { document.getElementById(role === 'admin' ? 'loginPass' : 'loginUser').focus(); }, 100);
}

async function executeLogin() {
    const user = document.getElementById('loginUser').value.trim();
    const pass = document.getElementById('loginPass').value.trim();
    const errLbl = document.getElementById('loginError');
    if(!user || !pass) { errLbl.innerText = "Vui lòng nhập đủ thông tin!"; return; }
    
    errLbl.innerText = "Đang kết nối Drive...";
    
    try {
        let res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'login', username: user, password: pass })
        });
        let data = await res.json();
        
        if (data.success) {
            currentUser = { username: data.username, role: data.role, password: pass };
            localStorage.setItem('tn_session', JSON.stringify(currentUser));
            
            db.folders = data.folders || [];
            db.exams = data.exams || [];
            if(data.role === 'admin') db.users = data.users || [];
            
            errLbl.innerText = "";
            setupUIAfterLogin();
            renderFolders();
            
            if (data.role === 'admin') {
                renderUserTable();
                switchView(7);
            } else {
                switchView(0);
                if (pendingShareId) handleSharedExam();
            }
        } else {
            errLbl.innerText = data.error;
        }
    } catch (e) {
        errLbl.innerText = "Lỗi kết nối mạng API!";
    }
}

async function silentLoginAndLoadData(userCache) {
    setStatus("Đang tải dữ liệu từ Drive...");
    try {
        let res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'login', username: userCache.username, password: userCache.password })
        });
        let data = await res.json();
        if (data.success) {
            db.folders = data.folders || [];
            db.exams = data.exams || [];
            if(data.role === 'admin') db.users = data.users || [];
            
            setupUIAfterLogin();
            renderFolders();
            
            if (data.role === 'admin') {
                renderUserTable();
                switchView(7);
            } else {
                switchView(0);
                if (pendingShareId) handleSharedExam();
            }
        } else {
            localStorage.removeItem('tn_session');
            switchView(8);
        }
    } catch(e) {
        setStatus("Lỗi mạng, vui lòng tải lại trang.");
    }
}

async function saveDB() {
    setStatus("Đang đồng bộ lên Drive...");
    try {
        let pullRes = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'login', username: currentUser.username, password: currentUser.password })
        });
        let pullData = await pullRes.json();
        
        if (pullData.success) {
            if (currentUser.role === 'admin') {
                db.folders = pullData.folders || [];
                db.exams = pullData.exams || [];
            } else {
                let otherFolders = (pullData.folders || []).filter(f => f.owner !== currentUser.username);
                let otherExams = (pullData.exams || []).filter(e => e.owner !== currentUser.username);
                
                let myFolders = db.folders.filter(f => f.owner === currentUser.username);
                let myExams = db.exams.filter(e => e.owner === currentUser.username);
                
                db.folders = [...otherFolders, ...myFolders];
                db.exams = [...otherExams, ...myExams];
            }
        }

        await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'sync', role: currentUser.role, db: db })
        });
        setStatus("Sẵn sàng (Đã lưu Drive)");
    } catch(e) {
        setStatus("Lỗi đồng bộ!");
    }
}

function setupUIAfterLogin() {
    const header = document.getElementById('mainHeader');
    let oldAdminBtn = document.getElementById('btnGoAdmin');
    if(oldAdminBtn) oldAdminBtn.remove();
    let oldLogoutBtn = document.getElementById('btnLogout');
    if(oldLogoutBtn) oldLogoutBtn.remove();

    let shareArea = document.getElementById('shareInputArea');
    let btnToggle = document.getElementById('btnToggleSidebar');

    if (currentUser.role === 'admin') {
        if(shareArea) shareArea.classList.add('hidden');
        if(btnToggle) btnToggle.classList.add('hidden'); 

        let adminBtn = document.createElement('button');
        adminBtn.id = 'btnGoAdmin';
        adminBtn.className = 'btn';
        adminBtn.style.marginRight = '10px';
        adminBtn.innerText = '⚙️ Quản lý Users';
        adminBtn.onclick = () => { renderUserTable(); switchView(7); };
        header.insertBefore(adminBtn, header.childNodes[0]);
        
        let btnBackHome = document.querySelector('#view-7 button');
        if(btnBackHome) btnBackHome.classList.add('hidden');
    } else {
        if(shareArea) shareArea.classList.remove('hidden');
        if(btnToggle) btnToggle.classList.remove('hidden');
    }
    
    let logoutBtn = document.createElement('button');
    logoutBtn.id = 'btnLogout';
    logoutBtn.className = 'btn btn-danger';
    logoutBtn.innerText = 'Đăng xuất (' + currentUser.username + ')';
    logoutBtn.onclick = () => {
        localStorage.removeItem('tn_session');
        location.reload(); 
    };
    header.appendChild(logoutBtn);
}

// --- 4. GIAO DIỆN CHUNG ---
function switchView(idNumber) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    let targetView = document.getElementById('view-' + idNumber);
    if(targetView) targetView.classList.add('active');

    let showCreate = (idNumber === 0 && currentUser && currentUser.role === 'user');
    let btnCreate = document.getElementById('btnCreateExam');
    if(btnCreate) btnCreate.classList.toggle('hidden', !showCreate);
    
    // Đảm bảo ẩn Sidebar ở màn hình đăng nhập hoặc admin
    let sidebar = document.getElementById('sidebar');
    if (idNumber === 8 || idNumber === 6) {
        sidebar.classList.add('hidden');
    } else if (currentUser && currentUser.role === 'admin') {
        sidebar.classList.add('hidden');
    } else {
        sidebar.classList.remove('hidden');
    }

    setStatus("Sẵn sàng");
}

function setStatus(text) { document.getElementById('lblStatus').innerText = "Trạng thái: " + text; }
function toggleDisplay(id) { document.getElementById(id).classList.toggle('hidden'); }

function showConfirm(title, msg, yesTxt, action, isRed) {
    viewBeforeConfirm = getActiveViewIndex();
    document.getElementById('confTitle').innerText = title;
    document.getElementById('confMsg').innerText = msg;
    let btnYes = document.getElementById('btnConfYes');
    btnYes.innerText = yesTxt;
    btnYes.className = isRed ? "btn btn-danger" : "btn btn-primary";
    confirmAction = action;
    switchView(5);
}

function getActiveViewIndex() { 
    let activeView = document.querySelector('.view.active');
    if(activeView) return parseInt(activeView.id.replace('view-', ''));
    return 0;
}

// --- LOGIC CHIA SẺ ĐỀ THI ---
function shareExam() {
    let baseUrl = window.location.origin + window.location.pathname;
    let link = baseUrl + '?share=' + currentExamId;
    
    if (navigator.clipboard) {
        navigator.clipboard.writeText(link).then(() => {
            customAlert("Đã copy link chia sẻ thành công!\nHãy dán gửi cho bạn bè để họ nhận đề thi nhé.", "Chia sẻ đề thi");
        }).catch(() => {
            customPrompt("Hãy copy đường link bên dưới để chia sẻ:", link, "Chia sẻ đề thi", () => {});
        });
    } else {
        customPrompt("Hãy copy đường link bên dưới để chia sẻ:", link, "Chia sẻ đề thi", () => {});
    }
}

function receiveSharedLink() {
    let link = document.getElementById('txtShareLink').value.trim();
    if (!link) return customAlert("Vui lòng dán link vào ô trống!", "Lỗi");

    let extractedId = null;
    try {
        let url = new URL(link);
        extractedId = url.searchParams.get('share');
    } catch(e) {
        if (link.length > 5 && !link.includes('/')) {
            extractedId = link;
        }
    }

    if (extractedId) {
        pendingShareId = extractedId;
        document.getElementById('txtShareLink').value = '';
        handleSharedExam(); 
    } else {
        customAlert("Link không hợp lệ hoặc không chứa mã đề thi!", "Lỗi");
    }
}

function handleSharedExam() {
    let sharedExam = db.exams.find(e => e.id === pendingShareId);
    
    if (!sharedExam) {
        customAlert("Rất tiếc! Đề thi này không tồn tại hoặc đã bị người chia sẻ xóa mất rồi.", "Lỗi", () => {
            window.history.replaceState({}, document.title, window.location.pathname);
            pendingShareId = null;
        });
        return;
    }

    if (sharedExam.owner === currentUser.username) {
        customAlert("Đây là đề thi của chính bạn rồi mà!", "Thông báo", () => {
            window.history.replaceState({}, document.title, window.location.pathname);
            pendingShareId = null;
        });
        return;
    }

    showConfirm("Nhận đề thi được chia sẻ", `Bạn vừa nhận được một đề thi: "${sharedExam.name}".\n\nBạn có muốn copy nó vào tài khoản của mình để làm bài không?`, "Nhận Đề Thi", "acceptShare", false);
}


// --- 5. LOGIC ADMIN (Thêm, Sửa, Xóa User) ---
function renderUserTable() {
    const tbody = document.getElementById('userTableBody');
    tbody.innerHTML = '';
    db.users.forEach(u => {
        if(u.role === 'admin') return; 
        let tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="padding: 10px;">${u.username}</td>
            <td style="padding: 10px;">${u.password}</td>
            <td style="padding: 10px;">User</td>
            <td style="padding: 10px; text-align: right;">
                <button class="btn" style="padding: 5px 10px; margin-right: 5px;" onclick="editUser('${u.id}')">Sửa Pass</button>
                <button class="btn btn-danger" style="padding: 5px 10px;" onclick="deleteUser('${u.id}')">Xóa</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function createNewUser() {
    const u = document.getElementById('newUsername').value.trim();
    const p = document.getElementById('newPassword').value.trim();
    if(!u || !p) return customAlert("Vui lòng nhập đủ thông tin!", "Lỗi");
    
    if(db.users.find(user => user.username.toLowerCase() === u.toLowerCase())) {
        return customAlert("Tên đăng nhập này đã tồn tại! Vui lòng chọn tên khác.", "Lỗi");
    }
    
    db.users.push({ id: generateId(), username: u, password: p, role: 'user' });
    document.getElementById('newUsername').value = '';
    document.getElementById('newPassword').value = '';
    
    switchView(10); 
    await saveDB(); 
    renderUserTable();
    switchView(7); 
}

async function editUser(id) {
    let user = db.users.find(u => u.id === id);
    customPrompt(`Nhập mật khẩu mới cho user [${user.username}]:`, user.password, "Đổi mật khẩu", async (newPass) => {
        if(newPass && newPass.trim() !== '') {
            user.password = newPass.trim();
            switchView(10);
            await saveDB();
            renderUserTable();
            switchView(7);
        }
    });
}

async function deleteUser(id) {
    customConfirmUI("Bạn có chắc chắn muốn xóa user này vĩnh viễn?", "Xóa User", async () => {
        let userToDel = db.users.find(u => u.id === id);
        db.folders = db.folders.filter(f => f.owner !== userToDel.username);
        db.exams = db.exams.filter(e => e.owner !== userToDel.username);
        db.users = db.users.filter(u => u.id !== id);
        
        switchView(10);
        await saveDB();
        renderUserTable();
        switchView(7);
    });
}

// --- 6. LOGIC THƯ MỤC & ĐỀ THI ---
function renderFolders() {
    const list = document.getElementById('folderList');
    list.innerHTML = '';
    
    let myFolders = db.folders;
    if (currentUser && currentUser.role !== 'admin') {
        myFolders = db.folders.filter(f => f.owner === currentUser.username);
    }

    myFolders.forEach(f => {
        let li = document.createElement('li');
        li.className = `folder-item ${f.id === currentFolderId ? 'active' : ''}`;
        li.innerText = f.name;
        
        li.onclick = () => {
            selectFolder(f.id);
            // Khi thao tác trên màn nhỏ (<= 1024px), chọn xong thư mục thì đóng lại luôn cho gọn
            if (window.innerWidth <= 1024) {
                document.getElementById('sidebar').classList.add('collapsed');
            }
        };
        list.appendChild(li);
    });
    
    if(currentUser && currentUser.role === 'user') {
        document.getElementById('btnDelFolder').classList.toggle('hidden', !currentFolderId);
        document.getElementById('btnNewFolder').classList.remove('hidden');
    } else {
        document.getElementById('btnDelFolder').classList.add('hidden');
        document.getElementById('btnNewFolder').classList.add('hidden'); 
    }
}

function toggleFolderInput() {
    document.getElementById('folderInputBox').classList.toggle('hidden');
    document.getElementById('btnNewFolder').classList.toggle('hidden');
    if (currentFolderId) document.getElementById('btnDelFolder').classList.toggle('hidden');
}

async function createFolder() {
    let name = document.getElementById('txtFolderName').value.trim();
    if (name) {
        let exists = db.folders.find(f => f.owner === currentUser.username && f.name.toLowerCase() === name.toLowerCase());
        if (exists) {
            return customAlert("Thư mục này đã tồn tại! Vui lòng chọn một tên khác.", "Lỗi");
        }

        db.folders.push({ id: generateId(), name: name, owner: currentUser.username });
        toggleFolderInput(); 
        
        switchView(10); 
        await saveDB();
        renderFolders();
        switchView(0); 
    }
}

function selectFolder(id) {
    currentFolderId = id; renderFolders(); renderExams(); switchView(0);
}

function confirmDeleteFolder() { showConfirm("Xóa thư mục", "Xóa thư mục và TOÀN BỘ đề thi?", "Xóa", "deleteFolder", true); }

function renderExams() {
    const container = document.getElementById('examContainer');
    container.innerHTML = '';
    if (!currentFolderId) { container.innerHTML = '<p>Vui lòng chọn thư mục bên trái.</p>'; return; }
    
    let myExams = db.exams.filter(e => e.folderId === currentFolderId && e.owner === currentUser.username);
    
    if (myExams.length === 0) container.innerHTML = '<p style="color: var(--n-muted)">Chưa có đề thi nào.</p>';
    
    myExams.forEach(ex => {
        let div = document.createElement('div');
        div.className = 'exam-item'; div.innerText = `📄 ${ex.name}`;
        div.onclick = () => openMenu(ex);
        container.appendChild(div);
    });
}

// --- 7. SMART EDITOR & KIỂM TRA TRÙNG TÊN ---
function showImportView() {
    if (!currentFolderId) return setStatus("Lỗi: Vui lòng chọn thư mục");
    currentExamId = null;
    document.getElementById('impTitle').value = '';
    document.getElementById('impBody').value = 'Câu 1: ';
    updateLivePreview(); switchView(1);
}

function handleSmartEditor(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        const textarea = e.target;
        const text = textarea.value;
        const cursorPos = textarea.selectionStart;
        const textBefore = text.substring(0, cursorPos);
        const lines = textBefore.split('\n');
        const currentLine = lines[lines.length - 1].trim().toUpperCase();
        
        let injection = "\n";
        if (currentLine.startsWith("CÂU") && currentLine.includes(":")) injection += "A. ";
        else if (currentLine.startsWith("A.")) injection += "B. ";
        else if (currentLine.startsWith("B.")) injection += "C. ";
        else if (currentLine.startsWith("C.")) injection += "D. ";
        else if (currentLine.startsWith("D.")) injection += "Đáp án: ";
        else if (currentLine.startsWith("ĐÁP ÁN:")) {
            const count = (text.toUpperCase().match(/ĐÁP ÁN:/g) || []).length;
            injection += `\nCâu ${count + 1}: `;
        }
        
        textarea.value = textBefore + injection + text.substring(textarea.selectionEnd);
        textarea.selectionStart = textarea.selectionEnd = cursorPos + injection.length;
        updateLivePreview();
    }
}

function parseFormat(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    let qs = [];
    for (let i = 0; i < lines.length; i += 6) {
        try {
            if (i + 5 >= lines.length) break;
            let qText = lines[i].replace(/^Câu\s*\d+[:\.]\s*/i, "").trim();
            let opts = lines.slice(i+1, i+5).map(opt => opt.replace(/^[A-D][:\.]\s*/i, "").trim());
            let ansLine = lines[i+5].toUpperCase();
            let ans = ansLine.match(/([A-D])$/)?.[1] || "";
            if (['A', 'B', 'C', 'D'].includes(ans)) qs.push({ q: qText, o: opts, a: ans });
        } catch (e) { break; }
    }
    return qs;
}

function updateLivePreview() {
    const text = document.getElementById('impBody').value;
    const qs = parseFormat(text);
    let html = `<p style="color: var(--n-muted); font-size: 14px;"><i>Đang nhận dạng ${qs.length} câu...</i></p><hr>`;
    qs.forEach((q, i) => {
        html += `<p><b style="font-size: 16px; color: var(--n-primary);">Câu ${i+1}: ${q.q}</b></p>`;
        ['A','B','C','D'].forEach((lbl, j) => {
            html += `<p style="margin: 2px 0 2px 15px;"><b>${lbl}.</b> ${q.o[j]}</p>`;
        });
        if (q.a) html += `<p style="color: var(--n-green-bd); font-weight: bold; margin-left: 15px;">✓ Đáp án đúng: ${q.a}</p>`;
        else html += `<p style="color: var(--n-muted); font-style: italic; margin-left: 15px;">...Đang chờ đáp án...</p>`;
        html += '<hr>';
    });
    document.getElementById('impPreview').innerHTML = html;
}

function saveExam() {
    const title = document.getElementById('impTitle').value.trim();
    const qs = parseFormat(document.getElementById('impBody').value);
    if (!title || qs.length === 0) return customAlert("Vui lòng nhập tên và ít nhất 1 câu hỏi đúng định dạng.", "Lỗi");
    
    let existingExam = db.exams.find(e => 
        e.folderId === currentFolderId && 
        e.owner === currentUser.username && 
        e.name.toLowerCase() === title.toLowerCase()
    );

    if (existingExam && existingExam.id !== currentExamId) {
        pendingExamSave = { title: title, qs: qs, overwriteId: existingExam.id, source: 'editor' };
        document.getElementById('conflictMsg').innerText = `Đề thi mang tên "${title}" đã tồn tại trong thư mục này. Bạn muốn xử lý thế nào?`;
        switchView(9); 
        return;
    }

    executeSaveExam(title, qs);
}

async function executeSaveExam(title, qs, overwriteId = null) {
    switchView(10); 

    if (overwriteId) {
        let ex = db.exams.find(e => e.id === overwriteId);
        ex.questions = qs;
        if (currentExamId && currentExamId !== overwriteId) {
            db.exams = db.exams.filter(e => e.id !== currentExamId);
        }
    } else if (currentExamId) {
        let ex = db.exams.find(e => e.id === currentExamId);
        ex.name = title; 
        ex.questions = qs;
    } else {
        db.exams.push({ id: generateId(), folderId: currentFolderId, name: title, questions: qs, owner: currentUser.username });
    }
    
    await saveDB(); 
    renderExams(); 
    switchView(0); 
}

async function executeAcceptShare(sharedExamObj, targetFolderId, newName) {
    switchView(10); 

    let newExam = JSON.parse(JSON.stringify(sharedExamObj));
    newExam.id = generateId();
    newExam.folderId = targetFolderId;
    newExam.owner = currentUser.username;
    newExam.name = newName;

    db.exams.push(newExam);
    await saveDB(); 

    customAlert("Tuyệt vời! Đã copy đề thi vào thư mục của bạn!", "Thành công", () => {
        window.history.replaceState({}, document.title, window.location.pathname);
        pendingShareId = null;
        selectFolder(targetFolderId); 
    });
}

// --- BẢNG ĐIỀU KHIỂN TRÙNG TÊN ---
async function handleConflict(action) {
    let p = pendingExamSave;
    pendingExamSave = null; 

    if (p.source === 'editor') {
        if (action === 'overwrite') {
            await executeSaveExam(p.title, p.qs, p.overwriteId);
        } else if (action === 'rename') {
            switchView(1); 
            document.getElementById('impTitle').value = p.title + " (Bản mới)";
            document.getElementById('impTitle').focus(); 
        } else {
            switchView(1); 
        }
    } 
    else if (p.source === 'share') {
        if (action === 'overwrite') {
            switchView(10); 
            let targetExam = db.exams.find(e => e.id === p.overwriteId);
            targetExam.questions = JSON.parse(JSON.stringify(p.sharedExamObj.questions));
            await saveDB();
            
            customAlert("Đã ghi đè dữ liệu mới vào đề thi cũ thành công!", "Thành công", () => {
                window.history.replaceState({}, document.title, window.location.pathname);
                pendingShareId = null;
                selectFolder(p.targetFolderId);
            });
        } else if (action === 'rename') {
            customPrompt("Vui lòng nhập tên mới cho đề thi:", p.title + " (Bản mới)", "Đổi tên đề thi", async (userInputName) => {
                if (userInputName && userInputName.trim() !== "") {
                    await executeAcceptShare(p.sharedExamObj, p.targetFolderId, userInputName.trim());
                } else {
                    window.history.replaceState({}, document.title, window.location.pathname);
                    pendingShareId = null;
                    selectFolder(p.targetFolderId);
                }
            });
        } else {
            window.history.replaceState({}, document.title, window.location.pathname);
            pendingShareId = null;
            selectFolder(p.targetFolderId);
        }
    }
}

// --- 8. MENU & QUIZ LÀM BÀI ---
function openMenu(exam) {
    currentExamId = exam.id;
    document.getElementById('menuTitle').innerText = exam.name;
    
    let isAppUser = (currentUser && currentUser.role === 'user');
    
    let btnEdit = document.getElementById('btnEditExam');
    let btnDel = document.getElementById('btnDelExam');
    let btnShare = document.getElementById('btnShareExam');
    
    if(btnEdit) btnEdit.classList.toggle('hidden', !isAppUser); 
    if(btnDel) btnDel.classList.toggle('hidden', !isAppUser); 
    if(btnShare) btnShare.classList.toggle('hidden', !isAppUser); 
    
    switchView(4);
}

function prepareEdit() {
    let ex = db.exams.find(e => e.id === currentExamId);
    document.getElementById('impTitle').value = ex.name;
    let txt = ex.questions.map((q, i) => 
        `Câu ${i+1}: ${q.q}\nA. ${q.o[0]}\nB. ${q.o[1]}\nC. ${q.o[2]}\nD. ${q.o[3]}\nĐáp án: ${q.a}\n`
    ).join("\n");
    document.getElementById('impBody').value = txt;
    updateLivePreview(); switchView(1);
}

function confirmDeleteExam() { showConfirm("Xóa đề thi", "Chắc chắn muốn xóa vĩnh viễn đề này?", "Xóa", "deleteExam", true); }

function startQuiz(mode) {
    quizMode = mode; quizData = db.exams.find(e => e.id === currentExamId).questions;
    quizIndex = 0; userAnswers = {}; flaggedQs.clear(); practiceClicked = {};
    
    document.getElementById('quizNavArea').classList.toggle('hidden', mode === 'practice');
    document.getElementById('btnFlag').classList.toggle('hidden', mode === 'practice');
    
    // Đóng ngăn kéo khay trắc nghiệm phải nếu đang mở
    document.getElementById('quizNavArea').classList.remove('open');

    switchView(2); loadQuestion();
}

function confirmExitQuiz() { showConfirm("Thoát", "Kết quả sẽ không được lưu. Chắc chắn thoát?", "Đồng ý", "exitQuiz", false); }

function loadQuestion() {
    const q = quizData[quizIndex];
    document.getElementById('lblQText').innerText = `Câu ${quizIndex + 1} / ${quizData.length}:\n\n${q.q}`;
    document.getElementById('lblFeedback').innerText = "";
    
    const btns = document.querySelectorAll('#optionsContainer .opt-btn');
    const mapping = ['A','B','C','D'];
    
    btns.forEach((btn, i) => {
        btn.innerText = `${mapping[i]}. ${q.o[i]}`;
        btn.className = "btn opt-btn";
        btn.disabled = false;
        
        if (quizMode === 'test') {
            if (userAnswers[quizIndex] === i) btn.classList.add('selected');
        } else {
            let clicked = practiceClicked[quizIndex] || new Set();
            if (clicked.has(i)) {
                if (mapping[i] === q.a) { 
                    btn.classList.add('correct'); 
                    document.getElementById('lblFeedback').innerHTML = `<span style="color:var(--n-green-bd)">✓ Đã chọn đúng.</span>`; 
                }
                else btn.classList.add('wrong');
            }
        }
    });

    let btnPrev = document.getElementById('btnPrev');
    let btnNext = document.getElementById('btnNext');
    let btnSubmit = document.getElementById('btnSubmitExam');

    if (quizMode === 'practice') {
        btnPrev.classList.add('hidden');
        btnNext.classList.add('hidden');
        btnSubmit.classList.add('hidden');
    } else {
        btnPrev.classList.toggle('hidden', quizIndex === 0);
        let isLast = quizIndex === quizData.length - 1;
        btnNext.classList.toggle('hidden', isLast);
        btnSubmit.classList.toggle('hidden', !isLast);
        
        let isFlagged = flaggedQs.has(quizIndex);
        let btnFlag = document.getElementById('btnFlag');
        btnFlag.innerText = isFlagged ? "⚑ Bỏ cờ" : "⚑ Đánh cờ";
        btnFlag.className = "btn" + (isFlagged ? " nav-btn flagged" : "");
        renderNavGrid();
    }
}

function selectAnswer(i) {
    if (quizMode === 'test') {
        userAnswers[quizIndex] = i;
        loadQuestion();
    } else {
        const q = quizData[quizIndex];
        const mapping = ['A','B','C','D'];
        
        if (!(quizIndex in userAnswers)) userAnswers[quizIndex] = i;
        
        if (!practiceClicked[quizIndex]) practiceClicked[quizIndex] = new Set();
        practiceClicked[quizIndex].add(i);
        
        let lbl = document.getElementById('lblFeedback');
        if (mapping[i] === q.a) {
            lbl.innerHTML = `<span style="color:var(--n-green-bd)">✓ Chính xác. Đang chuyển câu...</span>`;
            document.querySelectorAll('#optionsContainer .opt-btn').forEach(b => b.disabled = true);
            
            setTimeout(() => { 
                if (quizIndex < quizData.length - 1) navigateQ(1); 
                else executeConfirm('submitExam'); 
            }, 800);
        } else {
            lbl.innerHTML = `<span style="color:var(--n-red-bd)">✗ Sai rồi. Bạn hãy chọn lại.</span>`;
        }
        loadQuestion();
    }
}

function navigateQ(step) { quizIndex += step; loadQuestion(); }

function toggleFlag() { flaggedQs.has(quizIndex) ? flaggedQs.delete(quizIndex) : flaggedQs.add(quizIndex); loadQuestion(); }

function renderNavGrid() {
    const grid = document.getElementById('navGrid');
    grid.innerHTML = '';
    quizData.forEach((_, i) => {
        let btn = document.createElement('button');
        btn.className = "nav-btn";
        if (i === quizIndex) btn.classList.add('current');
        if (flaggedQs.has(i)) btn.classList.add('flagged');
        else if (i in userAnswers) btn.classList.add('done');
        
        btn.innerText = flaggedQs.has(i) ? "🚩" : (i in userAnswers ? "✓" : (i+1));
        btn.onclick = () => { 
            quizIndex = i; 
            loadQuestion(); 
            // Nếu màn nhỏ đang mở khay câu hỏi thì chọn xong tự đóng lại
            if(window.innerWidth <= 1024) document.getElementById('quizNavArea').classList.remove('open');
        };
        grid.appendChild(btn);
    });
}

// --- 9. RESULTS SCREEN ---
function confirmSubmitExam() {
    if (quizMode === 'test') {
        let unanswered = quizData.length - Object.keys(userAnswers).length;
        if (unanswered > 0) return showConfirm("Nộp bài", `Bạn còn ${unanswered} câu chưa làm. Vẫn nộp bài?`, "Nộp bài", "submitExam", false);
    }
    executeConfirm('submitExam');
}

function generateResultHTML() {
    let cCount = 0; let wCount = 0;
    let cHtml = ''; let wHtml = '';
    const mapping = ['A','B','C','D'];
    
    quizData.forEach((q, i) => {
        let correctIdx = mapping.indexOf(q.a);
        let cText = `${q.a}. ${q.o[correctIdx]}`;
        let uIdx = userAnswers[i];
        let isCorrect = false;
        let uText = "Chưa trả lời";
        
        if (uIdx !== undefined) {
            uText = `${mapping[uIdx]}. ${q.o[uIdx]}`;
            isCorrect = (mapping[uIdx] === q.a);
        }
        
        let item = `<div class="res-item"><p style="font-weight:bold;">Câu ${i+1}: ${q.q}</p>`;
        if (isCorrect) {
            cCount++;
            item += `<p class="text-green">✓ Đáp án: ${cText}</p></div>`;
            cHtml += item;
        } else {
            wCount++;
            item += `<p class="text-red">✗ Bạn chọn: ${uText}</p><p class="text-green">→ Đáp án đúng: ${cText}</p></div>`;
            wHtml += item;
        }
    });
    
    let score = (cCount / quizData.length) * 10;
    document.getElementById('resScore').innerText = `${Number.isInteger(score) ? score : score.toFixed(2)} / 10`;
    document.getElementById('resCount').innerText = `Số câu đúng: ${cCount} / ${quizData.length}`;
    
    document.getElementById('btnToggleWrong').innerText = `▼ Danh sách câu sai (${wCount}/${quizData.length})`;
    document.getElementById('btnToggleCorrect').innerText = `▼ Danh sách câu đúng (${cCount}/${quizData.length})`;

    document.getElementById('wrongList').innerHTML = wHtml || '<p>Tuyệt vời, không sai câu nào!</p>';
    document.getElementById('correctList').innerHTML = cHtml || '<p>Chưa có câu đúng.</p>';
    switchView(3);
}

// --- 10. ACTIONS EXECUTOR ---
async function executeConfirm(actionStr = confirmAction) {
    if (actionStr === "deleteFolder") {
        switchView(10); 
        db.folders = db.folders.filter(f => f.id !== currentFolderId);
        db.exams = db.exams.filter(e => e.folderId !== currentFolderId);
        currentFolderId = null; 
        await saveDB();
        renderFolders(); 
        renderExams(); 
        switchView(0);
    } else if (actionStr === "deleteExam") {
        switchView(10); 
        db.exams = db.exams.filter(e => e.id !== currentExamId);
        await saveDB();
        renderExams(); 
        switchView(0);
    } else if (actionStr === "exitQuiz") {
        switchView(0);
    } else if (actionStr === "submitExam") {
        generateResultHTML();
    } else if (actionStr === "acceptShare") {
        let sharedExam = db.exams.find(e => e.id === pendingShareId);
        if (sharedExam) {
            let myFolders = db.folders.filter(f => f.owner === currentUser.username);
            let shareFolder = myFolders.find(f => f.name === "Đề được chia sẻ");
            
            if (!shareFolder) {
                shareFolder = { id: generateId(), name: "Đề được chia sẻ", owner: currentUser.username };
                db.folders.push(shareFolder);
            }
            
            let copyName = sharedExam.name;
            let existingInShare = db.exams.find(e => e.folderId === shareFolder.id && e.owner === currentUser.username && e.name.toLowerCase() === copyName.toLowerCase());
            
            if (existingInShare) {
                pendingExamSave = {
                    title: copyName,
                    sharedExamObj: sharedExam,
                    overwriteId: existingInShare.id,
                    targetFolderId: shareFolder.id,
                    source: 'share'
                };
                document.getElementById('conflictMsg').innerText = `Đề thi "${copyName}" đã tồn tại trong thư mục "Đề được chia sẻ". Bạn muốn xử lý thế nào?`;
                switchView(9);
                return; 
            }

            await executeAcceptShare(sharedExam, shareFolder.id, copyName);
        } else {
            switchView(0);
        }
    }
}

window.onload = init;