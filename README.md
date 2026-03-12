# biodash-lab-dashboard

# BioDash – Laboratory Experiment Dashboard

BioDash is a web-based dashboard for storing, managing, and visualizing laboratory experiment data.

## Features

- Experiment registry
- CSV / TSV / Excel data import
- Spreadsheet-style editing
- Dynamic parameters
- Threshold-based alerts
- Interactive data visualization

## Tech Stack

- FastAPI
- MySQL
- JavaScript
- Chart.js
- HTML/CSS

## Requirements

- Python 3.11 or higher  
- MySQL Server

(Tested with Python 3.13)

## Installation

 1. Clone the repository

git clone https://github.com/chandana-0504/biodash-lab-dashboard.git  
cd biodash-lab-dashboard

 2. Create a virtual environment

python -m venv venv  
source venv/bin/activate

 3. Install dependencies

pip install -r requirements.txt

 4. Create the MySQL database

This project requires a MySQL database named **biodash**.

Open MySQL:

mysql -u root -p

Then run:

CREATE DATABASE biodash;

You do **not** need to create tables manually.  
The application automatically creates all required tables when the server starts.

 5. Run the application

uvicorn main:app --reload

 6. Open the dashboard

Open your browser and go to:

http://127.0.0.1:8000

## Project Structure

main.py – FastAPI backend  
templates/ – HTML templates  
static/ – CSS and JavaScript  

## License

MIT License
