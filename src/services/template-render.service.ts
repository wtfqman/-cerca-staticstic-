import fs from 'node:fs/promises';
import path from 'node:path';

import Handlebars from 'handlebars';

import { DOCUMENT_TEMPLATE_ROOT } from '../documents/document.constants';
import { config } from '../config';

export class TemplateRenderService {
  private readonly engine = Handlebars.create();
  private readonly templateCache = new Map<string, Handlebars.TemplateDelegate>();

  constructor() {
    this.engine.registerHelper('eq', (left, right) => left === right);
  }

  async renderDocument(templatePath: string, viewModel: Record<string, unknown>) {
    const body = await this.renderTemplate(templatePath, viewModel);
    const layoutPath = path.join(DOCUMENT_TEMPLATE_ROOT, 'layout.hbs');
    return this.renderTemplate(layoutPath, {
      ...viewModel,
      body,
      fontFamily: config.pdf.fontFamily
    });
  }

  private async renderTemplate(templatePath: string, viewModel: Record<string, unknown>) {
    const absolutePath = path.resolve(templatePath);
    let template = this.templateCache.get(absolutePath);

    if (!template) {
      const source = await fs.readFile(absolutePath, 'utf-8');
      template = this.engine.compile(source);
      this.templateCache.set(absolutePath, template);
    }

    return template(viewModel);
  }
}
