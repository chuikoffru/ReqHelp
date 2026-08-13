import { useState, useCallback } from 'react'
import Header from './components/Header'
import InputStep from './components/InputStep'
import AnalyzingStep from './components/AnalyzingStep'
import ResultsStep from './components/ResultsStep'
import LoginForm from './components/LoginForm'
import RegisterForm from './components/RegisterForm'
import { useAuth } from './context/AuthContext'
import { apiFetch, ApiError } from './lib/api'
import type { AnalysisResult } from '../shared/analysis'

type Step = 'input' | 'analyzing' | 'results'
type AuthView = 'login' | 'register'

export default function App() {
  const { user, loading } = useAuth()
  const [authView, setAuthView] = useState<AuthView>('login')
  const [step, setStep] = useState<Step>('input')
  const [text, setText] = useState('')
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [analysisError, setAnalysisError] = useState<string | null>(null)

  const handleSetText = useCallback((value: string) => {
    setText(value)
    setAnalysisError(null)
  }, [])

  const handleAnalyze = useCallback(async () => {
    if (!text.trim()) return
    setAnalysisError(null)
    setStep('analyzing')
    try {
      const res = await apiFetch<AnalysisResult>('/api/analyze', {
        method: 'POST',
        body: JSON.stringify({ text }),
      })
      setResult(res)
      setStep('results')
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Не удалось проанализировать ТЗ'
      setAnalysisError(message)
      setStep('input')
    }
  }, [text])

  const handleReset = useCallback(() => {
    setStep('input')
    setResult(null)
    setAnalysisError(null)
  }, [])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-50 to-white">
        <p className="text-sm text-slate-500">Загрузка…</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
        {authView === 'login' ? (
          <LoginForm onSwitchToRegister={() => setAuthView('register')} />
        ) : (
          <RegisterForm onSwitchToLogin={() => setAuthView('login')} />
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <Header onReset={step !== 'input' ? handleReset : undefined} />

      <main className="mx-auto w-full">
        {step === 'input' && (
          <InputStep
            text={text}
            setText={handleSetText}
            onAnalyze={handleAnalyze}
            analysisError={analysisError}
          />
        )}

        {step === 'analyzing' && <AnalyzingStep />}

        {step === 'results' && result && (
          <ResultsStep result={result} onReset={handleReset} />
        )}
      </main>

      <footer className="border-t border-slate-100 py-6 text-center text-xs text-slate-400">
        ТЗ-Ассистент · Прототип · Анализ LLM · Ollama (qwen3.5:4b-nvfp4)
      </footer>
    </div>
  )
}
