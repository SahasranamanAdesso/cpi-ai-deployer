sap.ui.define([
  'sap/ui/core/mvc/Controller',
  'sap/m/MessageToast'
], function (Controller, MessageToast) {
  'use strict';

  const STATUS_STATE = {
    RUNNING: 'Warning',
    STARTED: 'Success',
    ERROR: 'Error',
    TIMEOUT: 'Warning',
    FAILED: 'Error'
  };

  const POLL_INTERVAL_MS = 2000;
  const SERVICE_URL = '/deploy';

  return Controller.extend('cpideployer.sample.controller.App', {

    onInit: function () {
      this._zipBase64 = null;
      this._pollHandle = null;
      this._i18n = this.getView().getModel('i18n').getResourceBundle();
    },

    onFileChange: function (event) {
      const file = event.getParameter('files') && event.getParameter('files')[0];
      const deployButton = this.byId('deployButton');

      this._zipBase64 = null;
      deployButton.setEnabled(false);

      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        // reader.result is a data: URL - strip the "data:...;base64," prefix.
        this._zipBase64 = reader.result.split(',')[1];
        deployButton.setEnabled(true);
      };
      reader.onerror = () => {
        MessageToast.show(this._i18n.getText('fileReadError'));
      };
      reader.readAsDataURL(file);
    },

    onDeployPress: async function () {
      const id = this.byId('artifactIdInput').getValue().trim();
      const name = this.byId('artifactNameInput').getValue().trim();
      const packageId = this.byId('packageIdInput').getValue().trim();

      if (!id || !name || !packageId || !this._zipBase64) {
        MessageToast.show(this._i18n.getText('validationError'));
        return;
      }

      this._setStatus('RUNNING', this._i18n.getText('statusRunning'));
      this._hideError();
      this.byId('deployButton').setEnabled(false);

      try {
        const response = await fetch(`${SERVICE_URL}/deployIflow`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, name, packageId, zipBase64: this._zipBase64 })
        });

        const body = await response.json();

        if (!response.ok) {
          throw new Error((body.error && body.error.message) || `Request failed with status ${response.status}`);
        }

        this._pollJob(body.jobId);
      } catch (err) {
        this._setStatus('FAILED', this._i18n.getText('statusStartFailed'));
        this._showError(err.message);
        this.byId('deployButton').setEnabled(true);
      }
    },

    _pollJob: function (jobId) {
      clearTimeout(this._pollHandle);

      const poll = async () => {
        try {
          const response = await fetch(`${SERVICE_URL}/deploymentStatus(jobId='${encodeURIComponent(jobId)}')`);
          const job = await response.json();

          if (!response.ok) {
            throw new Error((job.error && job.error.message) || 'Could not fetch deployment status.');
          }

          if (job.status === 'RUNNING') {
            this._setStatus('RUNNING', this._i18n.getText('statusRunning'));
            this._pollHandle = setTimeout(poll, POLL_INTERVAL_MS);
            return;
          }

          this.byId('deployButton').setEnabled(true);

          if (job.status === 'STARTED') {
            this._setStatus('STARTED', this._i18n.getText('statusStarted', [job.artifactId]));
          } else if (job.status === 'ERROR') {
            this._setStatus('ERROR', this._i18n.getText('statusError', [job.artifactId]));
          } else if (job.status === 'TIMEOUT') {
            this._setStatus('TIMEOUT', this._i18n.getText('statusTimeout'));
          } else {
            this._setStatus('FAILED', this._i18n.getText('statusFailed'));
            if (job.error) this._showError(job.error);
          }
        } catch (err) {
          this.byId('deployButton').setEnabled(true);
          this._setStatus('FAILED', this._i18n.getText('statusFailed'));
          this._showError(err.message);
        }
      };

      poll();
    },

    _setStatus: function (statusKey, text) {
      const statusText = this.byId('statusText');
      const statusBusy = this.byId('statusBusy');

      statusText.setText(text);
      statusText.setState(STATUS_STATE[statusKey] || 'None');
      statusBusy.setVisible(statusKey === 'RUNNING');
    },

    _showError: function (message) {
      const strip = this.byId('errorStrip');
      strip.setText(message);
      strip.setVisible(true);
    },

    _hideError: function () {
      this.byId('errorStrip').setVisible(false);
    }

  });
});
