import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Loader2 } from 'lucide-react';

interface SemanticModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (query: string) => void;
  isLoading?: boolean;
  response?: string | null;
}

export function SemanticModal({
  open,
  onOpenChange,
  onSubmit,
  isLoading,
  response,
}: SemanticModalProps) {
  const [prompt, setPrompt] = React.useState('Les documents similaires à...');

  const handleSubmit = () => {
    if (!prompt.trim()) {
      return;
    }
    onSubmit(prompt.trim());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Recherche sémantique</DialogTitle>
          <DialogDescription>
            Interroge les documents en langage naturel. L’IA te propose les textes les plus proches.
          </DialogDescription>
        </DialogHeader>

        <Textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          className="w-full min-h-[140px]"
        />

        <DialogFooter className="flex flex-col gap-3">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>LLM : Embeddings / search</span>
            {isLoading && (
              <span className="flex items-center gap-1">
                <Loader2 className="w-4 h-4 animate-spin" /> Chargement...
              </span>
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button onClick={handleSubmit} disabled={isLoading}>
              Lancer la recherche
            </Button>
          </div>
          {response && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <p className="text-xs uppercase tracking-[0.4em] text-slate-400 mb-2">Réponse IA</p>
              <p>{response}</p>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
