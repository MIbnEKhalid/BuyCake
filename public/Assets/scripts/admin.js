// Image preview for cake forms
document.addEventListener('DOMContentLoaded', () => {
    const imageUrlInput = document.getElementById('image_url');
    if (imageUrlInput) {
      imageUrlInput.addEventListener('change', function() {
        const preview = document.querySelector('.image-preview') || 
          document.createElement('img');
        
        if (!preview.classList.contains('image-preview')) {
          preview.classList.add('image-preview');
          imageUrlInput.after(preview);
        }
        
        preview.src = this.value;
      });
    }
    
    // Confirm before deleting
    document.querySelectorAll('form[action*="delete"]').forEach(form => {
      form.addEventListener('submit', function(e) {
        if (!confirm('Are you sure you want to delete this?')) {
          e.preventDefault();
        }
      });
    });
  });