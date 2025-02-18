import os
import glob
import uvicorn
import requests
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from transformers import pipeline
from sentence_transformers import SentenceTransformer
import faiss
import numpy as np
import uuid
from collections import deque

app = FastAPI()

# ----------------------------
# 1. Load and Build Corpus
# ----------------------------

# Path to the dataset
dataset_path = r"C:\johnhopkin_project\JHU Chatbot"
print("Path to dataset files:", dataset_path)

# Extract relevant files from the dataset
corpus_files = glob.glob(os.path.join(dataset_path, "**", "*.txt"), recursive=True)
dataset_corpus = []

# Function to read files
def read_file(file_path):
    with open(file_path, "r", encoding="utf8") as file:
        return file.read().strip()

# Process each file
for file in corpus_files:
    try:
        text = read_file(file)
        if text:
            dataset_corpus.append(text)
    except Exception as e:
        print(f"Error reading {file}: {e}")

# If no text files found, use a default corpus
if not dataset_corpus:
    dataset_corpus = [
        "Diabetes is a chronic condition that affects how your body processes blood sugar.",
        "Hypertension, also known as high blood pressure, increases the risk of heart disease.",
        "Asthma is a respiratory condition marked by spasms in the bronchi of the lungs.",
        "COVID-19 is caused by the SARS-CoV-2 virus and presents with symptoms such as fever, cough, and fatigue.",
        "Cancer involves the uncontrolled growth of abnormal cells and can affect various organs."
    ]

# ----------------------------
# 2. Load Models and Build FAISS Index
# ----------------------------

# Load your QA model
qa_pipeline = pipeline("question-answering", model="deepset/roberta-base-squad2")

# Load an embedding model for FAISS retrieval
embedding_model = SentenceTransformer("pritamdeka/S-BioBert-snli-multinli-stsb")

# Compute embeddings and build FAISS index
corpus_embeddings = embedding_model.encode(dataset_corpus, convert_to_tensor=True)
embedding_dim = corpus_embeddings.shape[1]

index = faiss.IndexFlatL2(embedding_dim)
index.add(corpus_embeddings.cpu().numpy())

# ----------------------------
# 3. Utility: Fetch Dynamic Context via Wikipedia API
# ----------------------------
def fetch_wikipedia_summary(query):
    """
    Fetch a summary from Wikipedia using its API.
    This provides dynamic context if FAISS fails.
    """
    url = "https://en.wikipedia.org/w/api.php"
    params = {
        "action": "query",
        "format": "json",
        "generator": "search",
        "gsrsearch": query,
        "prop": "extracts",
        "exintro": True,
        "explaintext": True,
        "gsrlimit": 1,
    }
    try:
        response = requests.get(url, params=params, timeout=5)
        response.raise_for_status()
        data = response.json()
        pages = data.get("query", {}).get("pages", {})

        if pages:
            page = next(iter(pages.values()))
            return page.get("extract", "")
    except Exception as e:
        print("Wikipedia API error:", e)
    
    return ""

# ----------------------------
# 4. WebSocket Chat Endpoint
# ----------------------------

# Session management for multi-turn history
sessions = {}

@app.websocket("/chat")
async def chat_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("✅ WebSocket connected to client")
    
    session_id = str(uuid.uuid4())
    sessions[session_id] = deque(maxlen=5)  # Store last 5 exchanges

    try:
        while True:
            question = await websocket.receive_text()
            print(f"🔹 Received from frontend: {question}")

            # Step 1: Retrieve context using FAISS
            query_embedding = embedding_model.encode([question], convert_to_tensor=True)
            distances, indices = index.search(query_embedding.cpu().numpy(), k=3)

            print("📊 FAISS Retrieval - Distances:", distances)
            print("📊 FAISS Retrieval - Indices:", indices)

            # Check if FAISS returned valid indices
            retrieved_context = ""
            if len(indices[0]) > 0 and distances[0][0] < 10:  # Threshold to ensure relevance
                best_candidate_index = indices[0][0]
                retrieved_context = dataset_corpus[best_candidate_index]
                print(f"📖 Using retrieved context: {retrieved_context}")

            # Step 2: If FAISS failed, try Wikipedia
            if not retrieved_context.strip():
                print("⚠️ FAISS retrieval failed. Trying Wikipedia...")
                retrieved_context = fetch_wikipedia_summary(question)
                print(f"🌍 Wikipedia Context: {retrieved_context}")

            # Step 3: Generate Answer using QA model
            response_text = "I don't have enough data to answer that."
            if retrieved_context.strip():
                try:
                    answer = qa_pipeline(question=question, context=retrieved_context)
                    response_text = answer["answer"]
                    print(f"🤖 AI Model Response: {response_text}")
                except Exception as e:
                    print(f"🚨 QA Model Error: {e}")

            # Step 4: Store chat history
            sessions[session_id].append(question)
            sessions[session_id].append(response_text)

            # Send response back to frontend
            await websocket.send_text(response_text)
            print(f"✅ Message sent to frontend: {response_text}")

    except WebSocketDisconnect:
        print(f"⚠️ Client {session_id} disconnected")
        del sessions[session_id]

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
