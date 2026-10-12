import os
import tempfile
import uuid
import json
from flask import Flask, render_template, request, send_file, jsonify, flash, redirect, url_for, session
from werkzeug.utils import secure_filename
import sys
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

# 添加src目录到Python路径
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from generate_calendar import generate_ics_from_html_content, parse_courses_info, generate_ics_for_course
from parse_personal_info import extract_student_id, extract_student_name
from parse_course_info import get_course_materials_term
from csv_export import export_detailed_courses_to_csv
from image_generator import generate_course_card_image
import hashlib
from encryption import encrypt
from visit_counter import visit_counter

# 获取项目根目录路径
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATE_DIR = os.path.join(BASE_DIR, 'templates')
STATIC_DIR = os.path.join(BASE_DIR, 'static')

app = Flask(__name__, 
           template_folder=TEMPLATE_DIR,
           static_folder=STATIC_DIR)
app.secret_key = 'ucdavis_course_manager_secret_key_2024'

# 配置上传文件夹
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'uploads')
TEMP_FOLDER = os.path.join(BASE_DIR, 'temp')
DATA_FOLDER = os.path.join(BASE_DIR, 'data')
ALLOWED_EXTENSIONS = {'html', 'htm', 'txt'}

# 确保文件夹存在
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(TEMP_FOLDER, exist_ok=True)
os.makedirs(DATA_FOLDER, exist_ok=True)

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['TEMP_FOLDER'] = TEMP_FOLDER
app.config['DATA_FOLDER'] = DATA_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 8 * 1024 * 1024  # 8MB max file size

def allowed_file(filename):
    """Check if file extension is allowed"""
    if '.' in filename:
        # Check file extension
        return filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS
    else:
        # No extension files are allowed
        return True

def generate_unique_filename():
    """Generate unique filename"""
    return f"{uuid.uuid4().hex}.ics"

def save_courses_data(courses_info, html_content):
    """Save courses data to file instead of session"""
    data_id = str(uuid.uuid4())
    data_file = os.path.join(app.config['DATA_FOLDER'], f"{data_id}.json")
    
    # Save courses info
    with open(data_file, 'w', encoding='utf-8') as f:
        json.dump(courses_info, f, ensure_ascii=False, indent=2)
    
    # Save HTML content
    html_file = os.path.join(app.config['DATA_FOLDER'], f"{data_id}.html")
    with open(html_file, 'w', encoding='utf-8') as f:
        f.write(html_content)
    
    return data_id

def load_courses_data(data_id):
    """Load courses data from file"""
    data_file = os.path.join(app.config['DATA_FOLDER'], f"{data_id}.json")
    html_file = os.path.join(app.config['DATA_FOLDER'], f"{data_id}.html")
    
    if not os.path.exists(data_file) or not os.path.exists(html_file):
        return None, None
    
    with open(data_file, 'r', encoding='utf-8') as f:
        courses_info = json.load(f)
    
    with open(html_file, 'r', encoding='utf-8') as f:
        html_content = f.read()
    
    return courses_info, html_content

@app.route('/')
def index():
    """Home page"""
    # 记录访问统计
    ip_address = request.remote_addr
    user_agent = request.headers.get('User-Agent', '')
    total_visits = visit_counter.record_visit(ip_address, user_agent)
    
    return render_template('index.html', visit_count=total_visits)

@app.route('/tutorial')
def tutorial():
    """Tutorial page"""
    # 记录访问统计
    ip_address = request.remote_addr
    user_agent = request.headers.get('User-Agent', '')
    total_visits = visit_counter.record_visit(ip_address, user_agent)
    
    return render_template('tutorial.html', visit_count=total_visits)

@app.route('/upload', methods=['POST'])
def upload_file():
    """Handle file upload"""
    if 'file' not in request.files:
        flash('No file selected', 'error')
        return redirect(request.url)
    
    file = request.files['file']
    if file.filename == '':
        flash('No file selected', 'error')
        return redirect(request.url)
    
    if file and allowed_file(file.filename):
        try:
            # Read file content with encoding detection
            file_content = file.read()
            
            # Try different encodings
            encodings = ['utf-8', 'latin-1', 'cp1252', 'iso-8859-1', 'ascii']
            html_content = None
            
            for encoding in encodings:
                try:
                    html_content = file_content.decode(encoding)
                    break
                except UnicodeDecodeError:
                    continue
            
            if html_content is None:
                return jsonify({
                    'success': False,
                    'message': 'Unable to read file encoding. Please ensure the file is saved with UTF-8 or another standard encoding.'
                })
            
            # First check if this is a valid UC Davis Schedule Builder file
            # This check must pass before any other processing
            from parse_personal_info import extract_student_name
            student_name = extract_student_name(html_content)
            if not student_name:
                return jsonify({
                    'success': False,
                    'message': 'Invalid file! This does not appear to be a UC Davis Schedule Builder file. Please check if the file format is correct.'
                })
            
            # Only proceed with further processing if student name is detected
            # Extract student ID and course materials term
            student_id = extract_student_id(html_content)
            
            # Check if there are any courses in the schedule
            from parse_crn import extract_registered_crns, extract_waitlisted_crns, extract_all_schedule_crns
            registered_crns = extract_registered_crns(html_content)
            waitlisted_crns = extract_waitlisted_crns(html_content)
            all_schedule_crns = extract_all_schedule_crns(html_content)
            
            if not all_schedule_crns:
                return jsonify({
                    'success': False,
                    'message': 'No courses found in the file. Please ensure you have courses in your schedule.'
                })
            
            # Get course materials term from the first course (assuming all courses are from same term)
            courses_info = parse_courses_info(html_content)
            course_materials_term = ""
            if courses_info and len(courses_info) > 0:
                first_crn = courses_info[0]['crn']
                course_materials_term = get_course_materials_term(html_content, first_crn)
            
            # Generate filename using student ID and term (remove spaces from term)
            course_materials_term_clean = course_materials_term.replace(' ', '') if course_materials_term else ""
            
            if student_id and course_materials_term_clean:
                filename = f"{student_id}_{course_materials_term_clean}.html"
            elif student_id:
                filename = f"{student_id}_unknown_term.html"
            elif course_materials_term_clean:
                filename = f"unknown_student_{course_materials_term_clean}.html"
            else:
                filename = f"unknown_{uuid.uuid4().hex[:8]}.html"
            
            # Save uploaded file with new filename
            filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(html_content)
            
            # 解析所有课程信息（包括未注册的）
            courses_info = parse_courses_info(html_content, include_all=True)
            
            if courses_info:
                # Save data to file and store ID in session
                data_id = save_courses_data(courses_info, html_content)
                session['data_id'] = data_id
                
                # 统计不同状态的课程数量
                registered_count = sum(1 for c in courses_info if c.get('is_registered'))
                waitlisted_count = sum(1 for c in courses_info if c.get('is_waitlisted'))
                planned_count = sum(1 for c in courses_info if c.get('is_planned') and not c.get('is_registered') and not c.get('is_waitlisted'))
                
                return jsonify({
                    'success': True,
                    'courses_count': len(courses_info),
                    'registered_count': registered_count,
                    'waitlisted_count': waitlisted_count,
                    'planned_count': planned_count,
                    'message': f'Successfully parsed {len(courses_info)} courses! ({registered_count} registered, {waitlisted_count} waitlisted, {planned_count} planned)'
                })
            else:
                return jsonify({
                    'success': False,
                    'message': 'No courses found in the file. Please ensure you have registered or waitlisted courses in your schedule.'
                })
                
        except Exception as e:
            return jsonify({
                'success': False,
                'message': f'File processing error: {str(e)}'
            })
    else:
        return jsonify({
            'success': False,
            'message': 'Unsupported file format. Please upload HTML, TXT files or files without extension.'
        })

@app.route('/courses')
def show_courses():
    """Show parsed courses information"""
    if 'data_id' not in session:
        flash('No courses data found. Please upload a file first.', 'error')
        return redirect(url_for('index'))
    
    data_id = session['data_id']
    courses_info, html_content = load_courses_data(data_id)
    
    if not courses_info:
        flash('No courses data found. Please upload a file first.', 'error')
        return redirect(url_for('index'))
    
    # 记录访问统计
    ip_address = request.remote_addr
    user_agent = request.headers.get('User-Agent', '')
    total_visits = visit_counter.record_visit(ip_address, user_agent)
    
    return render_template('courses.html', courses=courses_info, visit_count=total_visits)

@app.route('/download_all')
def download_all_courses():
    """Download all courses as a single ICS file"""
    if 'data_id' not in session:
        flash('No file data found. Please upload a file first.', 'error')
        return redirect(url_for('index'))
    
    try:
        data_id = session['data_id']
        courses_info, html_content = load_courses_data(data_id)
        
        if not html_content:
            flash('No file data found. Please upload a file first.', 'error')
            return redirect(url_for('index'))
        
        ics_content = generate_ics_from_html_content(html_content)
        
        if ics_content:
            # Generate unique filename
            filename = generate_unique_filename()
            filepath = os.path.join(app.config['TEMP_FOLDER'], filename)
            
            # Save ICS file
            with open(filepath, 'wb') as f:
                f.write(ics_content.encode('utf-8'))
            
            return send_file(
                filepath,
                as_attachment=True,
                download_name='ucdavis_all_courses.ics',
                mimetype='text/calendar'
            )
        else:
            flash('Error generating calendar file.', 'error')
            return redirect(url_for('show_courses'))
            
    except Exception as e:
        flash(f'Error downloading file: {str(e)}', 'error')
        return redirect(url_for('show_courses'))

@app.route('/download_course/<crn>')
def download_course(crn):
    """Download a specific course as ICS file"""
    if 'data_id' not in session:
        flash('No file data found. Please upload a file first.', 'error')
        return redirect(url_for('index'))
    
    try:
        data_id = session['data_id']
        courses_info, html_content = load_courses_data(data_id)
        
        if not html_content:
            flash('No file data found. Please upload a file first.', 'error')
            return redirect(url_for('index'))
        
        ics_content = generate_ics_for_course(html_content, crn)
        
        if ics_content:
            # Generate unique filename
            filename = f"{crn}_{generate_unique_filename()}"
            filepath = os.path.join(app.config['TEMP_FOLDER'], filename)
            
            # Save ICS file
            with open(filepath, 'wb') as f:
                f.write(ics_content.encode('utf-8'))
            
            # Get course info for filename
            course_info = next((c for c in courses_info if c['crn'] == crn), None)
            
            if course_info:
                download_name = f"{course_info['subject_code']}_{course_info['course_number']}_{course_info['section_number']}.ics"
            else:
                download_name = f"course_{crn}.ics"
            
            return send_file(
                filepath,
                as_attachment=True,
                download_name=download_name,
                mimetype='text/calendar'
            )
        else:
            flash('Error generating calendar file for this course.', 'error')
            return redirect(url_for('show_courses'))
            
    except Exception as e:
        flash(f'Error downloading course file: {str(e)}', 'error')
        return redirect(url_for('show_courses'))

@app.route('/download_csv_detailed')
def download_csv_detailed():
    """Download courses as detailed CSV file (one row per meeting)"""
    if 'data_id' not in session:
        flash('No file data found. Please upload a file first.', 'error')
        return redirect(url_for('index'))
    
    try:
        data_id = session['data_id']
        courses_info, html_content = load_courses_data(data_id)
        
        if not courses_info:
            flash('No courses data found. Please upload a file first.', 'error')
            return redirect(url_for('index'))
        
        # Export to detailed CSV
        csv_filepath = export_detailed_courses_to_csv(courses_info, app.config['TEMP_FOLDER'])
        
        return send_file(
            csv_filepath,
            as_attachment=True,
            download_name='ucdavis_courses_detailed.csv',
            mimetype='text/csv'
        )
            
    except Exception as e:
        flash(f'Error downloading detailed CSV file: {str(e)}', 'error')
        return redirect(url_for('show_courses'))

@app.route('/download_course_image/<crn>')
def download_course_image(crn):
    """Download course card as PNG image"""
    if 'data_id' not in session:
        flash('No file data found. Please upload a file first.', 'error')
        return redirect(url_for('index'))
    
    try:
        data_id = session['data_id']
        courses_info, html_content = load_courses_data(data_id)
        
        if not courses_info:
            flash('No courses data found. Please upload a file first.', 'error')
            return redirect(url_for('index'))
        
        # 找到对应的课程
        course_info = next((c for c in courses_info if c['crn'] == crn), None)
        
        if not course_info:
            flash('Course not found.', 'error')
            return redirect(url_for('show_courses'))
        
        # 生成课程卡片图片
        image_filepath = generate_course_card_image(course_info, app.config['TEMP_FOLDER'])
        
        # 生成下载文件名
        course_code = f"{course_info['subject_code']}_{course_info['course_number']}_{course_info['section_number']}"
        download_name = f"course_card_{course_code}.png"
        
        return send_file(
            image_filepath,
            as_attachment=True,
            download_name=download_name,
            mimetype='image/png'
        )
            
    except Exception as e:
        flash(f'Error generating course image: {str(e)}', 'error')
        return redirect(url_for('show_courses'))

@app.route('/download_selected', methods=['POST'])
def download_selected_courses():
    """Download selected courses as a single ICS file"""
    if 'data_id' not in session:
        return jsonify({'success': False, 'message': 'No file data found. Please upload a file first.'}), 400
    
    try:
        data = request.get_json()
        if not data or 'crns' not in data:
            return jsonify({'success': False, 'message': 'No courses selected'}), 400
        
        selected_crns = data['crns']
        if not selected_crns:
            return jsonify({'success': False, 'message': 'No courses selected'}), 400
        
        data_id = session['data_id']
        courses_info, html_content = load_courses_data(data_id)
        
        if not html_content:
            return jsonify({'success': False, 'message': 'No file data found. Please upload a file first.'}), 400
        
        # 生成包含选定课程的 ICS 文件
        from icalendar import Calendar
        cal = Calendar()
        cal.add('prodid', '-//UCDavis Course Calendar//EN')
        cal.add('version', '2.0')
        cal.add('calscale', 'GREGORIAN')
        cal.add('method', 'PUBLISH')
        cal.add('x-wr-calname', 'UC Davis Courses')
        cal.add('x-wr-timezone', 'America/Los_Angeles')
        
        from generate_calendar import add_meeting_events, add_drop_date_event, add_final_exam_event
        
        for crn in selected_crns:
            add_meeting_events(cal, html_content, crn)
            add_drop_date_event(cal, html_content, crn)
            add_final_exam_event(cal, html_content, crn)
        
        # 生成 ICS 内容并确保使用正确的格式
        ics_content = cal.to_ical().decode('utf-8')
        # ICS 标准要求使用 CRLF 作为行尾
        lines = ics_content.splitlines()
        new_lines = []
        for line in lines:
            if line.startswith('BEGIN:VEVENT'):
                new_lines.append('')
            new_lines.append(line)
        ics_content = '\r\n'.join(new_lines)
        
        # 保存 ICS 文件
        filename = f"selected_courses_{uuid.uuid4().hex[:8]}.ics"
        filepath = os.path.join(app.config['TEMP_FOLDER'], filename)
        
        with open(filepath, 'wb') as f:
            f.write(ics_content.encode('utf-8'))
        
        return jsonify({
            'success': True,
            'download_url': url_for('download_temp_file', filename=filename)
        })
        
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error generating calendar: {str(e)}'}), 500


@app.route('/download_temp/<filename>')
def download_temp_file(filename):
    """Download a temporary file"""
    filepath = os.path.join(app.config['TEMP_FOLDER'], secure_filename(filename))
    if not os.path.exists(filepath):
        flash('File not found', 'error')
        return redirect(url_for('show_courses'))
    
    return send_file(
        filepath,
        as_attachment=True,
        download_name='ucdavis_selected_courses.ics',
        mimetype='text/calendar'
    )


@app.route('/api/stats')
def get_stats():
    """Get visit statistics"""
    stats = visit_counter.get_stats()
    return jsonify(stats)

@app.route('/api/parse', methods=['POST'])
def api_parse():
    """API endpoint for parsing HTML content"""
    try:
        data = request.get_json()
        if not data or 'html_content' not in data:
            return jsonify({'error': 'Missing HTML content'}), 400
        
        html_content = data['html_content']
        ics_content = generate_ics_from_html_content(html_content)
        
        if ics_content:
            return jsonify({
                'success': True,
                'ics_content': ics_content
            })
        else:
            return jsonify({
                'success': False,
                'error': 'Parsing failed'
            }), 400
            
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

def send_email(name, email, message):
    """Send email using Gmail SMTP with fallback"""
    try:
        # Email configuration
        sender_email = os.environ.get("SMTP_SENDER_EMAIL", "")
        sender_password = os.environ.get("SMTP_PASSWORD", "")
        receiver_email = os.environ.get("SMTP_RECEIVER_EMAIL", "")
        
        print(f"Attempting to send email from {sender_email} to {receiver_email}")
        
        # Create message
        msg = MIMEMultipart()
        msg['From'] = sender_email
        msg['To'] = receiver_email
        msg['Subject'] = f"New message from {name} via Richis Profile"
        
        # Email body
        body = f"""
        You have received a new message from your personal profile website:
        
        Name: {name}
        Email: {email}
        Message:
        {message}
        
        ---
        This message was sent from your personal profile contact form.
        """
        
        msg.attach(MIMEText(body, 'plain'))
        
        # Try Gmail SMTP first
        try:
            print("Attempting Gmail SMTP...")
            server = smtplib.SMTP('smtp.gmail.com', 587, timeout=30)
            server.starttls()
            server.login(sender_email, sender_password)
            
            text = msg.as_string()
            server.sendmail(sender_email, receiver_email, text)
            server.quit()
            print("Email sent successfully via Gmail!")
            return True
            
        except Exception as gmail_error:
            print(f"Gmail SMTP failed: {gmail_error}")
            print("Trying alternative method...")
            
            # Try alternative SMTP servers
            smtp_servers = [
                ('smtp.qq.com', 587),  # QQ邮箱
                ('smtp.163.com', 25),  # 163邮箱
                ('smtp.126.com', 25),  # 126邮箱
            ]
            
            for smtp_server, port in smtp_servers:
                try:
                    print(f"Trying {smtp_server}:{port}...")
                    server = smtplib.SMTP(smtp_server, port, timeout=10)
                    server.starttls()
                    server.login(sender_email, sender_password)
                    
                    text = msg.as_string()
                    server.sendmail(sender_email, receiver_email, text)
                    server.quit()
                    print(f"Email sent successfully via {smtp_server}!")
                    return True
                    
                except Exception as alt_error:
                    print(f"{smtp_server} failed: {alt_error}")
                    continue
            
            print("All SMTP servers failed")
            return False
            
    except Exception as e:
        print(f"Email sending error: {e}")
        return False

def save_message_to_file(name, email, message):
    """Save message to a file as backup"""
    try:
        import datetime
        timestamp = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        filename = f"message_{timestamp}.txt"
        filepath = os.path.join(app.config['DATA_FOLDER'], filename)
        
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(f"Time: {timestamp}\n")
            f.write(f"Name: {name}\n")
            f.write(f"Email: {email}\n")
            f.write(f"Message:\n{message}\n")
            f.write("-" * 50 + "\n")
        
        print(f"Message saved to file: {filepath}")
        return True
    except Exception as e:
        print(f"Error saving message to file: {e}")
        return False

@app.route('/send_message', methods=['POST'])
def send_message():
    """Handle contact form submission"""
    try:
        name = request.form.get('name', '').strip()
        email = request.form.get('email', '').strip()
        message = request.form.get('message', '').strip()
        
        print(f"Received message from {name} ({email}): {message[:50]}...")
        
        # Basic validation
        if not name or not email or not message:
            return jsonify({
                'success': False,
                'message': 'Please fill in all fields.'
            }), 400
        
        if len(message) > 1000:  # Limit message length
            return jsonify({
                'success': False,
                'message': 'Message is too long. Please keep it under 1000 characters.'
            }), 400
        
        # Send email
        print("Attempting to send email...")
        email_sent = send_email(name, email, message)
        
        # Always save message to file as backup
        save_message_to_file(name, email, message)
        
        if email_sent:
            print("Email sent successfully!")
            return jsonify({
                'success': True,
                'message': 'Message sent successfully! I will get back to you soon.'
            })
        else:
            print("Email sending failed!")
            return jsonify({
                'success': True,
                'message': 'Message saved! Email sending failed, but your message has been recorded. I will check it later.'
            })
        
    except Exception as e:
        print(f"Error in send_message route: {e}")
        return jsonify({
            'success': False,
            'message': 'An error occurred. Please try again later.'
        }), 500





if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000) 