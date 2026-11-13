// Modal dialog asking the user to pick one of several actions.
// Resolves with the chosen value, or null when dismissed (Escape / Cancel).
export interface DialogChoice {
  value: string;
  label: string;
}

export function askChoice(message: string, choices: DialogChoice[]): Promise<string | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'choice-dialog';

    const text = document.createElement('p');
    text.textContent = message;
    dialog.appendChild(text);

    const actions = document.createElement('div');
    actions.className = 'choice-actions';

    let result: string | null = null;
    choices.forEach((choice, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = choice.label;
      if (index === 0) button.classList.add('primary');
      button.addEventListener('click', () => {
        result = choice.value;
        dialog.close();
      });
      actions.appendChild(button);
    });

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => dialog.close());
    actions.appendChild(cancel);
    dialog.appendChild(actions);

    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });

    document.body.appendChild(dialog);
    dialog.showModal();
  });
}

// Modal dialog asking for a single line of text. Resolves with the entered
// text (trimmed), or null when dismissed (Escape / Cancel).
export function askText(message: string, defaultValue: string): Promise<string | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'choice-dialog';

    const form = document.createElement('form');
    form.method = 'dialog';

    const label = document.createElement('label');
    label.className = 'choice-text-label';
    label.textContent = message;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'choice-text-input';
    input.value = defaultValue;
    label.appendChild(input);
    form.appendChild(label);

    const actions = document.createElement('div');
    actions.className = 'choice-actions';

    const ok = document.createElement('button');
    ok.type = 'submit';
    ok.className = 'primary';
    ok.textContent = 'OK';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => dialog.close());

    actions.append(ok, cancel);
    form.appendChild(actions);
    dialog.appendChild(form);

    let result: string | null = null;
    form.addEventListener('submit', () => {
      result = input.value.trim();
    });

    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });

    document.body.appendChild(dialog);
    dialog.showModal();
    input.select();
  });
}

export interface DialogField {
  label: string;
  value: string;
}
// Modal dialog with one text field per entry. Resolves with the trimmed values
// in the same order, or null when dismissed (Escape / Cancel).
export function askFields(fields: DialogField[]): Promise<string[] | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'choice-dialog';
    const form = document.createElement('form');
    form.method = 'dialog';
    const inputs = fields.map(field => {
      const label = document.createElement('label');
      label.className = 'choice-text-label';
      label.textContent = field.label;
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'choice-text-input';
      input.value = field.value;
      label.appendChild(input);
      form.appendChild(label);
      return input;
    });
    const actions = document.createElement('div');
    actions.className = 'choice-actions';
    const ok = document.createElement('button');
    ok.type = 'submit';
    ok.className = 'primary';
    ok.textContent = 'OK';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => dialog.close());
    actions.append(ok, cancel);
    form.appendChild(actions);
    dialog.appendChild(form);
    let result: string[] | null = null;
    form.addEventListener('submit', () => {
      result = inputs.map(input => input.value.trim());
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });
    document.body.appendChild(dialog);
    dialog.showModal();
    inputs[0]?.select();
  });
}
